'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createApp, todayStr, addDays } = require('../src/app');

let server, base, db;

before(async () => {
  db = openDatabase(':memory:');
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => { server.close(); db.close(); });

async function call(method, path, body, cookie) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

const checkIn = addDays(todayStr(), 10);
const checkOut = addDays(todayStr(), 13);

test('lists destinations', async () => {
  const { status, data } = await call('GET', '/destinations');
  assert.equal(status, 200);
  assert.ok(data.destinations.length >= 10);
  assert.ok(data.destinations.some((d) => d.city === 'Berlin'));
});

test('searches hotels with dates and filters', async () => {
  const { status, data } = await call('GET', `/hotels?q=Berlin&checkIn=${checkIn}&checkOut=${checkOut}&guests=2`);
  assert.equal(status, 200);
  assert.ok(data.total > 0);
  assert.equal(data.stay.nights, 3);
  for (const h of data.results) assert.equal(h.city, 'Berlin');
  const sorted = await call('GET', `/hotels?q=Berlin&sort=price_asc`);
  const prices = sorted.data.results.map((h) => h.pricePerNight);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  const five = await call('GET', '/hotels?stars=5');
  assert.ok(five.data.results.every((h) => h.stars === 5));
});

test('rejects invalid dates', async () => {
  const past = await call('GET', `/hotels?q=Berlin&checkIn=2020-01-01&checkOut=2020-01-03`);
  assert.equal(past.status, 400);
  const reversed = await call('GET', `/hotels?q=Berlin&checkIn=${checkOut}&checkOut=${checkIn}`);
  assert.equal(reversed.status, 400);
});

test('full booking lifecycle: register, book, sell out, review, cancel', async () => {
  const reg = await call('POST', '/auth/register', { name: 'Test User', email: 'test@example.com', password: 'secret123' });
  assert.equal(reg.status, 201);
  const cookie = reg.cookie;
  assert.match(cookie, /^hs_session=/);

  const dup = await call('POST', '/auth/register', { name: 'X', email: 'TEST@example.com', password: 'secret123' });
  assert.equal(dup.status, 409);

  const bad = await call('POST', '/auth/login', { email: 'test@example.com', password: 'wrong-pass' });
  assert.equal(bad.status, 401);

  const detail = await call('GET', `/hotels/1?checkIn=${checkIn}&checkOut=${checkOut}&guests=1&rooms=1`);
  const room = detail.data.roomTypes.find((r) => r.bookable);
  const inventory = room.available;

  const guest = { firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com' };
  // Book every remaining room of this type.
  const booked = await call('POST', '/bookings', {
    hotelId: 1, roomTypeId: room.id, checkIn, checkOut, guests: inventory, rooms: inventory, ...guest,
  }, cookie);
  assert.equal(booked.status, 201, JSON.stringify(booked.data));
  assert.equal(booked.data.booking.totalPrice, room.pricePerNight * 3 * inventory);
  const ref = booked.data.booking.reference;

  // Overlapping stay is now sold out; adjacent stay is fine.
  const overlap = await call('POST', '/bookings', { hotelId: 1, roomTypeId: room.id, checkIn: addDays(checkIn, 2), checkOut: addDays(checkOut, 2), guests: 1, rooms: 1, ...guest });
  assert.equal(overlap.status, 409);
  const adjacent = await call('POST', '/bookings', { hotelId: 1, roomTypeId: room.id, checkIn: checkOut, checkOut: addDays(checkOut, 1), guests: 1, rooms: 1, ...guest });
  assert.equal(adjacent.status, 201);

  // Guest lookup requires the matching email.
  assert.equal((await call('GET', `/bookings/${ref}?email=ann@example.com`)).status, 200);
  assert.equal((await call('GET', `/bookings/${ref}?email=other@example.com`)).status, 404);

  const mine = await call('GET', '/bookings', null, cookie);
  assert.equal(mine.data.bookings.length, 1);

  // Review: allowed once.
  const rv = await call('POST', '/hotels/1/reviews', { rating: 9, title: 'Great', comment: 'Loved it' }, cookie);
  assert.equal(rv.status, 201);
  assert.equal((await call('POST', '/hotels/1/reviews', { rating: 9, title: 'Again', comment: 'x' }, cookie)).status, 409);

  // Wishlist
  assert.equal((await call('PUT', '/wishlist/2', null, cookie)).status, 200);
  assert.equal((await call('GET', '/wishlist', null, cookie)).data.hotels[0].id, 2);
  await call('DELETE', '/wishlist/2', null, cookie);
  assert.equal((await call('GET', '/wishlist', null, cookie)).data.hotels.length, 0);

  // Cancel (if hotel allows free cancellation) frees inventory.
  const hotel = db.prepare('SELECT free_cancellation FROM hotels WHERE id = 1').get();
  const cancel = await call('POST', `/bookings/${ref}/cancel`, {}, cookie);
  if (hotel.free_cancellation) {
    assert.equal(cancel.status, 200);
    assert.equal(cancel.data.booking.status, 'cancelled');
    const after = await call('GET', `/hotels/1?checkIn=${checkIn}&checkOut=${checkOut}`);
    assert.equal(after.data.roomTypes.find((r) => r.id === room.id).available, inventory);
  } else {
    assert.equal(cancel.status, 400);
  }
});

test('protected endpoints require sign-in', async () => {
  assert.equal((await call('GET', '/bookings')).status, 401);
  assert.equal((await call('GET', '/wishlist')).status, 401);
});
