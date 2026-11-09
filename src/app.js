'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { tx } = require('./db');

const SESSION_COOKIE = 'hs_session';
const SESSION_DAYS = 30;
const PAGE_SIZE = 10;
const MAX_NIGHTS = 30;
const MAX_ROOMS = 8;
const MAX_GUESTS = 30;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- helpers ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return d;
}

function todayStr() {
  const now = new Date();
  // Use the server's local calendar date.
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(s, n) {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Validates a stay. Returns null when both dates are absent and `required` is false.
 */
function parseStay(checkIn, checkOut, required) {
  if (!checkIn && !checkOut && !required) return null;
  const a = toDate(checkIn), b = toDate(checkOut);
  if (!a || !b) throw new HttpError(400, 'Please provide valid check-in and check-out dates (YYYY-MM-DD).');
  if (checkIn < todayStr()) throw new HttpError(400, 'Check-in date cannot be in the past.');
  const nights = Math.round((b - a) / 86400000);
  if (nights < 1) throw new HttpError(400, 'Check-out must be after check-in.');
  if (nights > MAX_NIGHTS) throw new HttpError(400, `Stays are limited to ${MAX_NIGHTS} nights.`);
  return { checkIn, checkOut, nights };
}

function intParam(v, def, min, max) {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `Value must be a whole number between ${min} and ${max}.`);
  return n;
}

function str(v, max = 200) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
  }
  return out;
}

function makeReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let s = 'HS';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

function round2(n) { return Math.round(n * 100) / 100; }

// ---------- app ----------

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));

  // --- prepared statements ---
  const q = {
    sessionUser: db.prepare(`SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
                             WHERE s.token = ? AND s.expires_at > datetime('now')`),
    insertSession: db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    purgeSessions: db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    insertUser: db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)'),
    hotel: db.prepare('SELECT * FROM hotels WHERE id = ?'),
    roomsForHotel: db.prepare('SELECT * FROM room_types WHERE hotel_id = ? ORDER BY price_per_night'),
    room: db.prepare('SELECT * FROM room_types WHERE id = ? AND hotel_id = ?'),
    overlapping: db.prepare(`SELECT check_in, check_out, rooms FROM bookings
                             WHERE room_type_id = ? AND status = 'confirmed' AND check_in < ? AND check_out > ?`),
    ratingStats: db.prepare('SELECT hotel_id, COUNT(*) AS cnt, AVG(rating) AS avg FROM reviews GROUP BY hotel_id'),
    ratingForHotel: db.prepare('SELECT COUNT(*) AS cnt, AVG(rating) AS avg FROM reviews WHERE hotel_id = ?'),
    reviewsForHotel: db.prepare('SELECT id, author_name, author_country, rating, title, comment, created_at FROM reviews WHERE hotel_id = ? ORDER BY created_at DESC LIMIT 50'),
    insertBooking: db.prepare(`INSERT INTO bookings
      (reference, user_id, hotel_id, room_type_id, check_in, check_out, guests, rooms, first_name, last_name, email, phone, special_requests, total_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    bookingByRef: db.prepare(`SELECT b.*, h.name AS hotel_name, h.city, h.country, h.address, h.images, h.free_cancellation,
                                     r.name AS room_name, r.beds
                              FROM bookings b JOIN hotels h ON h.id = b.hotel_id JOIN room_types r ON r.id = b.room_type_id
                              WHERE b.reference = ?`),
    bookingsForUser: db.prepare(`SELECT b.*, h.name AS hotel_name, h.city, h.country, h.address, h.images, h.free_cancellation,
                                        r.name AS room_name, r.beds
                                 FROM bookings b JOIN hotels h ON h.id = b.hotel_id JOIN room_types r ON r.id = b.room_type_id
                                 WHERE b.user_id = ? ORDER BY b.check_in DESC`),
    cancelBooking: db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`),
    userHasStayed: db.prepare(`SELECT 1 FROM bookings WHERE user_id = ? AND hotel_id = ? AND status = 'confirmed' LIMIT 1`),
    userReviewed: db.prepare('SELECT 1 FROM reviews WHERE user_id = ? AND hotel_id = ? LIMIT 1'),
    insertReview: db.prepare(`INSERT INTO reviews (hotel_id, user_id, author_name, author_country, rating, title, comment) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    wishlistIds: db.prepare('SELECT hotel_id FROM wishlist WHERE user_id = ?'),
    wishlistAdd: db.prepare('INSERT OR IGNORE INTO wishlist (user_id, hotel_id) VALUES (?, ?)'),
    wishlistRemove: db.prepare('DELETE FROM wishlist WHERE user_id = ? AND hotel_id = ?'),
    destinations: db.prepare(`SELECT city, country, COUNT(*) AS properties, MIN(images) AS images, AVG(lat) AS lat, AVG(lng) AS lng
                              FROM hotels GROUP BY city, country ORDER BY properties DESC, city`),
  };

  // --- availability ---

  /** Rooms still free for every night of [checkIn, checkOut). */
  function roomsAvailable(room, checkIn, checkOut) {
    const rows = q.overlapping.all(room.id, checkOut, checkIn);
    if (rows.length === 0) return room.total_rooms;
    let maxBooked = 0;
    for (let night = checkIn; night < checkOut; night = addDays(night, 1)) {
      let booked = 0;
      for (const b of rows) if (b.check_in <= night && b.check_out > night) booked += b.rooms;
      if (booked > maxBooked) maxBooked = booked;
    }
    return Math.max(0, room.total_rooms - maxBooked);
  }

  function hotelSummary(h) {
    return {
      id: h.id, name: h.name, city: h.city, country: h.country, address: h.address,
      propertyType: h.property_type, stars: h.stars, distanceKm: h.distance_km,
      lat: h.lat, lng: h.lng,
      amenities: JSON.parse(h.amenities), images: JSON.parse(h.images),
      freeCancellation: !!h.free_cancellation, breakfastIncluded: !!h.breakfast_included,
    };
  }

  function roomOffer(room, stay, guests, roomsWanted) {
    const available = stay ? roomsAvailable(room, stay.checkIn, stay.checkOut) : room.total_rooms;
    const fits = room.max_guests * roomsWanted >= guests;
    const nights = stay ? stay.nights : 1;
    return {
      id: room.id, name: room.name, description: room.description, beds: room.beds,
      maxGuests: room.max_guests, sizeSqm: room.size_sqm, pricePerNight: room.price_per_night,
      available, fits,
      bookable: fits && available >= roomsWanted,
      totalPrice: round2(room.price_per_night * nights * roomsWanted),
      nights,
    };
  }

  // --- auth middleware ---
  app.use((req, res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    req.sessionToken = token || null;
    req.user = token ? q.sessionUser.get(token) || null : null;
    next();
  });

  function requireUser(req) {
    if (!req.user) throw new HttpError(401, 'Please sign in to continue.');
    return req.user;
  }

  function startSession(res, userId) {
    const token = crypto.randomBytes(32).toString('hex');
    q.purgeSessions.run();
    q.insertSession.run(token, userId, `+${SESSION_DAYS} days`);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: 'lax', path: '/',
      maxAge: SESSION_DAYS * 86400000,
      secure: process.env.NODE_ENV === 'production',
    });
  }

  // ---------- API: auth ----------
  const api = express.Router();

  api.get('/auth/me', (req, res) => {
    res.json({ user: req.user });
  });

  api.post('/auth/register', (req, res) => {
    const name = str(req.body?.name, 80);
    const email = str(req.body?.email, 120).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!name) throw new HttpError(400, 'Please enter your name.');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    if (q.userByEmail.get(email)) throw new HttpError(409, 'An account with this email already exists.');
    const { lastInsertRowid } = q.insertUser.run(email, name, hashPassword(password));
    startSession(res, Number(lastInsertRowid));
    res.status(201).json({ user: { id: Number(lastInsertRowid), email, name } });
  });

  api.post('/auth/login', (req, res) => {
    const email = str(req.body?.email, 120).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = email && q.userByEmail.get(email);
    if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, 'Incorrect email or password.');
    startSession(res, user.id);
    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  });

  api.post('/auth/logout', (req, res) => {
    if (req.sessionToken) q.deleteSession.run(req.sessionToken);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // ---------- API: destinations & search ----------

  api.get('/destinations', (req, res) => {
    const rows = q.destinations.all().map((d) => ({
      city: d.city, country: d.country, properties: d.properties,
      image: JSON.parse(d.images)[0],
    }));
    res.json({ destinations: rows });
  });

  api.get('/hotels', (req, res) => {
    const term = str(req.query.q, 100);
    const stay = parseStay(req.query.checkIn, req.query.checkOut, false);
    const guests = intParam(req.query.guests, 2, 1, MAX_GUESTS);
    const roomsWanted = intParam(req.query.rooms, 1, 1, MAX_ROOMS);
    const page = intParam(req.query.page, 1, 1, 1000);
    const minPrice = req.query.minPrice ? Number(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;
    const stars = str(req.query.stars).split(',').map(Number).filter((n) => n >= 1 && n <= 5);
    const types = str(req.query.types, 300).split(',').map((s) => s.trim()).filter(Boolean);
    const amenities = str(req.query.amenities, 500).split(',').map((s) => s.trim()).filter(Boolean);
    const minRating = req.query.minRating ? Number(req.query.minRating) : null;
    const maxDistance = req.query.maxDistance ? Number(req.query.maxDistance) : null;
    const freeCancel = req.query.freeCancellation === '1';
    const breakfast = req.query.breakfast === '1';
    const sort = str(req.query.sort) || 'recommended';

    let sql = 'SELECT * FROM hotels';
    const params = [];
    if (term) {
      sql += ' WHERE city LIKE ? OR country LIKE ? OR name LIKE ?';
      const like = `%${term.replace(/[%_]/g, '')}%`;
      params.push(like, like, like);
    }
    const hotels = db.prepare(sql).all(...params);

    const ratings = new Map(q.ratingStats.all().map((r) => [r.hotel_id, r]));
    const wish = req.user ? new Set(q.wishlistIds.all(req.user.id).map((r) => r.hotel_id)) : new Set();

    let results = [];
    for (const h of hotels) {
      if (stars.length && !stars.includes(h.stars)) continue;
      if (types.length && !types.includes(h.property_type)) continue;
      if (freeCancel && !h.free_cancellation) continue;
      if (breakfast && !h.breakfast_included) continue;
      if (maxDistance !== null && h.distance_km > maxDistance) continue;
      const hotelAmenities = JSON.parse(h.amenities);
      if (amenities.length && !amenities.every((a) => hotelAmenities.includes(a))) continue;
      const r = ratings.get(h.id);
      const rating = r ? Math.round(r.avg * 10) / 10 : null;
      if (minRating !== null && (rating === null || rating < minRating)) continue;

      const offers = q.roomsForHotel.all(h.id).map((room) => roomOffer(room, stay, guests, roomsWanted));
      const bookable = offers.filter((o) => o.bookable);
      if (bookable.length === 0) continue; // sold out / cannot fit party
      const best = bookable.reduce((a, b) => (b.totalPrice < a.totalPrice ? b : a));
      const nightly = round2(best.totalPrice / best.nights);
      if (minPrice !== null && nightly < minPrice) continue;
      if (maxPrice !== null && nightly > maxPrice) continue;

      results.push({
        ...hotelSummary(h),
        rating, reviewCount: r ? r.cnt : 0,
        saved: wish.has(h.id),
        cheapestRoom: { id: best.id, name: best.name, beds: best.beds, available: best.available },
        pricePerNight: nightly,
        totalPrice: best.totalPrice,
        nights: best.nights,
        roomsLeft: Math.min(...bookable.map((o) => o.available)),
      });
    }

    const sorters = {
      recommended: (a, b) => ((b.rating || 6) * 10 + b.stars * 3 - b.distanceKm * 2) - ((a.rating || 6) * 10 + a.stars * 3 - a.distanceKm * 2),
      price_asc: (a, b) => a.pricePerNight - b.pricePerNight,
      price_desc: (a, b) => b.pricePerNight - a.pricePerNight,
      rating: (a, b) => (b.rating || 0) - (a.rating || 0) || b.reviewCount - a.reviewCount,
      stars: (a, b) => b.stars - a.stars || a.pricePerNight - b.pricePerNight,
      distance: (a, b) => a.distanceKm - b.distanceKm,
    };
    results.sort(sorters[sort] || sorters.recommended);

    const total = results.length;
    const prices = results.map((r) => r.pricePerNight);
    results = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    res.json({
      total, page, pageSize: PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
      stay, guests, rooms: roomsWanted,
      results,
    });
  });

  api.get('/hotels/:id', (req, res) => {
    const id = intParam(req.params.id, null, 1, Number.MAX_SAFE_INTEGER);
    const h = q.hotel.get(id);
    if (!h) throw new HttpError(404, 'Property not found.');
    const stay = parseStay(req.query.checkIn, req.query.checkOut, false);
    const guests = intParam(req.query.guests, 2, 1, MAX_GUESTS);
    const roomsWanted = intParam(req.query.rooms, 1, 1, MAX_ROOMS);
    const r = q.ratingForHotel.get(id);
    const canReview = !!req.user && !!q.userHasStayed.get(req.user.id, id) && !q.userReviewed.get(req.user.id, id);
    res.json({
      hotel: {
        ...hotelSummary(h),
        description: h.description,
        rating: r.cnt ? Math.round(r.avg * 10) / 10 : null,
        reviewCount: r.cnt,
        saved: req.user ? q.wishlistIds.all(req.user.id).some((w) => w.hotel_id === id) : false,
      },
      stay, guests, rooms: roomsWanted,
      roomTypes: q.roomsForHotel.all(id).map((room) => roomOffer(room, stay, guests, roomsWanted)),
      reviews: q.reviewsForHotel.all(id),
      canReview,
    });
  });

  api.post('/hotels/:id/reviews', (req, res) => {
    const user = requireUser(req);
    const id = intParam(req.params.id, null, 1, Number.MAX_SAFE_INTEGER);
    if (!q.hotel.get(id)) throw new HttpError(404, 'Property not found.');
    if (!q.userHasStayed.get(user.id, id)) throw new HttpError(403, 'You can only review properties you have booked.');
    if (q.userReviewed.get(user.id, id)) throw new HttpError(409, 'You have already reviewed this property.');
    const rating = intParam(req.body?.rating, null, 1, 10);
    if (rating === null) throw new HttpError(400, 'Please give a score from 1 to 10.');
    const title = str(req.body?.title, 100);
    const comment = str(req.body?.comment, 2000);
    if (!title || !comment) throw new HttpError(400, 'Please add a title and a comment.');
    q.insertReview.run(id, user.id, user.name, str(req.body?.country, 60), rating, title, comment);
    res.status(201).json({ ok: true });
  });

  // ---------- API: bookings ----------

  function bookingView(b) {
    return {
      reference: b.reference, status: b.status,
      hotelId: b.hotel_id, hotelName: b.hotel_name, city: b.city, country: b.country, address: b.address,
      image: JSON.parse(b.images)[0],
      roomTypeId: b.room_type_id, roomName: b.room_name, beds: b.beds,
      checkIn: b.check_in, checkOut: b.check_out, guests: b.guests, rooms: b.rooms,
      firstName: b.first_name, lastName: b.last_name, email: b.email, phone: b.phone,
      specialRequests: b.special_requests, totalPrice: b.total_price, createdAt: b.created_at,
      freeCancellation: !!b.free_cancellation,
      canCancel: b.status === 'confirmed' && !!b.free_cancellation && b.check_in > todayStr(),
    };
  }

  api.post('/bookings', (req, res) => {
    const body = req.body || {};
    const hotelId = intParam(body.hotelId, null, 1, Number.MAX_SAFE_INTEGER);
    const roomTypeId = intParam(body.roomTypeId, null, 1, Number.MAX_SAFE_INTEGER);
    if (!hotelId || !roomTypeId) throw new HttpError(400, 'Please choose a property and room.');
    const stay = parseStay(body.checkIn, body.checkOut, true);
    const guests = intParam(body.guests, 2, 1, MAX_GUESTS);
    const roomsWanted = intParam(body.rooms, 1, 1, MAX_ROOMS);
    const firstName = str(body.firstName, 60);
    const lastName = str(body.lastName, 60);
    const email = str(body.email, 120).toLowerCase();
    const phone = str(body.phone, 30);
    const requests = str(body.specialRequests, 1000);
    if (!firstName || !lastName) throw new HttpError(400, 'Please enter the main guest\'s first and last name.');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
    if (phone && !/^[+()\d\s-]{5,30}$/.test(phone)) throw new HttpError(400, 'Please enter a valid phone number.');

    const reference = tx(db, () => {
      const room = q.room.get(roomTypeId, hotelId);
      if (!room) throw new HttpError(404, 'Room not found.');
      const offer = roomOffer(room, stay, guests, roomsWanted);
      if (!offer.fits) throw new HttpError(400, `This room sleeps up to ${room.max_guests} guests per room. Add more rooms or choose a larger room.`);
      if (offer.available < roomsWanted) {
        throw new HttpError(409, offer.available === 0
          ? 'Sorry, this room just sold out for your dates.'
          : `Only ${offer.available} room(s) of this type are left for your dates.`);
      }
      let ref;
      do { ref = makeReference(); } while (q.bookingByRef.get(ref));
      q.insertBooking.run(ref, req.user ? req.user.id : null, hotelId, roomTypeId, stay.checkIn, stay.checkOut,
        guests, roomsWanted, firstName, lastName, email, phone, requests, offer.totalPrice);
      return ref;
    });
    res.status(201).json({ booking: bookingView(q.bookingByRef.get(reference)) });
  });

  api.get('/bookings', (req, res) => {
    const user = requireUser(req);
    res.json({ bookings: q.bookingsForUser.all(user.id).map(bookingView) });
  });

  /** A booking is visible to its owner, or to anyone who knows reference + email. */
  function loadAuthorisedBooking(req, ref, email) {
    const b = q.bookingByRef.get(str(ref, 20).toUpperCase());
    const ok = b && ((req.user && b.user_id === req.user.id) || (email && b.email === str(email, 120).toLowerCase()));
    if (!ok) throw new HttpError(404, 'We couldn\'t find a booking with those details.');
    return b;
  }

  api.get('/bookings/:ref', (req, res) => {
    const b = loadAuthorisedBooking(req, req.params.ref, req.query.email);
    res.json({ booking: bookingView(b) });
  });

  api.post('/bookings/:ref/cancel', (req, res) => {
    const b = loadAuthorisedBooking(req, req.params.ref, req.body?.email);
    const view = bookingView(b);
    if (b.status !== 'confirmed') throw new HttpError(400, 'This booking is already cancelled.');
    if (!view.canCancel) {
      throw new HttpError(400, b.free_cancellation
        ? 'Bookings can only be cancelled before the check-in date.'
        : 'This booking is non-refundable and cannot be cancelled online.');
    }
    q.cancelBooking.run(b.id);
    res.json({ booking: bookingView(q.bookingByRef.get(b.reference)) });
  });

  // ---------- API: wishlist ----------

  api.get('/wishlist', (req, res) => {
    const user = requireUser(req);
    const ratings = new Map(q.ratingStats.all().map((r) => [r.hotel_id, r]));
    const hotels = q.wishlistIds.all(user.id).map((w) => q.hotel.get(w.hotel_id)).filter(Boolean).map((h) => {
      const r = ratings.get(h.id);
      const cheapest = q.roomsForHotel.all(h.id)[0];
      return {
        ...hotelSummary(h), saved: true,
        rating: r ? Math.round(r.avg * 10) / 10 : null, reviewCount: r ? r.cnt : 0,
        pricePerNight: cheapest ? cheapest.price_per_night : null,
      };
    });
    res.json({ hotels });
  });

  api.put('/wishlist/:hotelId', (req, res) => {
    const user = requireUser(req);
    const id = intParam(req.params.hotelId, null, 1, Number.MAX_SAFE_INTEGER);
    if (!q.hotel.get(id)) throw new HttpError(404, 'Property not found.');
    q.wishlistAdd.run(user.id, id);
    res.json({ saved: true });
  });

  api.delete('/wishlist/:hotelId', (req, res) => {
    const user = requireUser(req);
    const id = intParam(req.params.hotelId, null, 1, Number.MAX_SAFE_INTEGER);
    q.wishlistRemove.run(user.id, id);
    res.json({ saved: false });
  });

  api.use((req, res) => { res.status(404).json({ error: 'Not found' }); });

  app.use('/api', api);
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
  app.use((req, res) => res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}

module.exports = { createApp, todayStr, addDays };
