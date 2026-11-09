'use strict';

/**
 * Deterministic demo data for HotelSucher.
 * Uses a seeded PRNG so every fresh database looks the same.
 */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CITIES = [
  { city: 'Berlin', country: 'Germany', lat: 52.52, lng: 13.405, streets: ['Friedrichstraße', 'Unter den Linden', 'Kurfürstendamm', 'Torstraße', 'Oranienstraße'], priceFactor: 1.0 },
  { city: 'Munich', country: 'Germany', lat: 48.1351, lng: 11.582, streets: ['Maximilianstraße', 'Leopoldstraße', 'Sendlinger Straße', 'Theresienstraße'], priceFactor: 1.15 },
  { city: 'Hamburg', country: 'Germany', lat: 53.5511, lng: 9.9937, streets: ['Jungfernstieg', 'Reeperbahn', 'Mönckebergstraße', 'Elbchaussee'], priceFactor: 1.05 },
  { city: 'Vienna', country: 'Austria', lat: 48.2082, lng: 16.3738, streets: ['Kärntner Straße', 'Graben', 'Mariahilfer Straße', 'Ringstraße'], priceFactor: 1.05 },
  { city: 'Zurich', country: 'Switzerland', lat: 47.3769, lng: 8.5417, streets: ['Bahnhofstrasse', 'Limmatquai', 'Niederdorfstrasse', 'Seefeldstrasse'], priceFactor: 1.6 },
  { city: 'Paris', country: 'France', lat: 48.8566, lng: 2.3522, streets: ['Rue de Rivoli', 'Boulevard Saint-Germain', 'Avenue des Champs-Élysées', 'Rue du Faubourg'], priceFactor: 1.4 },
  { city: 'London', country: 'United Kingdom', lat: 51.5074, lng: -0.1278, streets: ['Oxford Street', 'Baker Street', 'Kensington High Street', 'The Strand'], priceFactor: 1.5 },
  { city: 'Amsterdam', country: 'Netherlands', lat: 52.3676, lng: 4.9041, streets: ['Prinsengracht', 'Herengracht', 'Damrak', 'Kalverstraat'], priceFactor: 1.35 },
  { city: 'Barcelona', country: 'Spain', lat: 41.3874, lng: 2.1686, streets: ['La Rambla', 'Passeig de Gràcia', 'Carrer de Balmes', 'Avinguda Diagonal'], priceFactor: 1.1 },
  { city: 'Rome', country: 'Italy', lat: 41.9028, lng: 12.4964, streets: ['Via del Corso', 'Via Veneto', 'Via Nazionale', 'Via Condotti'], priceFactor: 1.15 },
  { city: 'Prague', country: 'Czech Republic', lat: 50.0755, lng: 14.4378, streets: ['Wenceslas Square', 'Národní', 'Pařížská', 'Karlova'], priceFactor: 0.75 },
  { city: 'Lisbon', country: 'Portugal', lat: 38.7223, lng: -9.1393, streets: ['Avenida da Liberdade', 'Rua Augusta', 'Rua Garrett', 'Rua do Alecrim'], priceFactor: 0.9 },
  { city: 'New York', country: 'United States', lat: 40.7128, lng: -74.006, streets: ['5th Avenue', 'Broadway', 'Madison Avenue', 'Lexington Avenue'], priceFactor: 1.7 },
  { city: 'Tokyo', country: 'Japan', lat: 35.6762, lng: 139.6503, streets: ['Ginza', 'Shinjuku', 'Shibuya', 'Roppongi'], priceFactor: 1.3 },
  { city: 'Dubai', country: 'United Arab Emirates', lat: 25.2048, lng: 55.2708, streets: ['Sheikh Zayed Road', 'Jumeirah Beach Road', 'Al Wasl Road', 'Downtown Boulevard'], priceFactor: 1.45 },
  { city: 'Kathmandu', country: 'Nepal', lat: 27.7172, lng: 85.324, streets: ['Thamel Marg', 'Durbar Marg', 'Lazimpat', 'Jhamsikhel'], priceFactor: 0.45 },
];

const NAME_PREFIX = ['Grand', 'Royal', 'Park', 'City', 'Central', 'Golden', 'Riverside', 'Old Town', 'Harbour', 'Skyline', 'Garden', 'Urban', 'Boutique', 'Palace', 'Sunset', 'Alpine'];
const NAME_SUFFIX = {
  Hotel: ['Hotel', 'Hotel & Spa', 'Plaza Hotel', 'Hotel Suites'],
  Apartment: ['Apartments', 'Residences', 'Serviced Flats'],
  Resort: ['Resort', 'Resort & Spa'],
  Hostel: ['Hostel', 'Backpackers'],
  Guesthouse: ['Guesthouse', 'Pension', 'Inn'],
  'Boutique Hotel': ['Boutique Hotel', 'Design Hotel', 'Maison'],
};
const TYPE_WEIGHTS = [['Hotel', 5], ['Apartment', 2], ['Boutique Hotel', 2], ['Guesthouse', 1], ['Hostel', 1], ['Resort', 1]];

const AMENITIES = ['Free WiFi', 'Parking', 'Swimming pool', 'Fitness centre', 'Spa', 'Restaurant', 'Bar', 'Airport shuttle', '24-hour front desk', 'Pet friendly', 'Air conditioning', 'Family rooms', 'Non-smoking rooms', 'Room service', 'Electric vehicle charging', 'Kitchen'];

const ROOM_TEMPLATES = [
  { name: 'Single Room', beds: '1 single bed', max: 1, size: 14, mult: 0.7, desc: 'A cosy room ideal for solo travellers, with a work desk and city views.' },
  { name: 'Standard Double Room', beds: '1 double bed', max: 2, size: 20, mult: 1.0, desc: 'Comfortable double room with private bathroom, flat-screen TV and blackout curtains.' },
  { name: 'Twin Room', beds: '2 single beds', max: 2, size: 22, mult: 1.05, desc: 'Bright twin room with two single beds — perfect for friends or colleagues.' },
  { name: 'Deluxe King Room', beds: '1 king bed', max: 2, size: 28, mult: 1.35, desc: 'Spacious room with a king-size bed, seating area, minibar and rain shower.' },
  { name: 'Family Room', beds: '1 double bed and 2 single beds', max: 4, size: 34, mult: 1.7, desc: 'Generous family room with space for four, plus a kettle and fridge.' },
  { name: 'Junior Suite', beds: '1 king bed and 1 sofa bed', max: 3, size: 42, mult: 2.1, desc: 'Elegant suite with a separate living area, bathtub and premium toiletries.' },
  { name: 'Executive Suite', beds: '1 king bed', max: 2, size: 60, mult: 3.0, desc: 'Our finest suite: panoramic views, lounge access and a marble bathroom.' },
];

const DESCRIPTIONS = [
  'Set in the heart of {city}, {name} offers stylish accommodation just {dist} km from the city centre. Guests enjoy a relaxed atmosphere, attentive staff and easy access to the main sights, shopping streets and public transport.',
  '{name} combines modern comfort with local character. All units feature soundproofing and quality bedding, and the friendly reception team is happy to share tips for exploring {city}.',
  'Located on {street}, {name} is a great base for discovering {city}. The property features thoughtfully designed rooms, a generous breakfast option and plenty of cafés and restaurants nearby.',
  'Whether you are travelling for business or leisure, {name} in {city} provides everything you need: comfortable rooms, fast WiFi and a convenient location {dist} km from the centre.',
];
const DESC_EXTRA = [
  'Couples particularly like the location — they rated it highly for a two-person trip.',
  'The surrounding neighbourhood is known for its vibrant nightlife and excellent food scene.',
  'Many guests highlight the excellent breakfast and the spotless rooms.',
  'Public transport is just a few minutes away on foot, connecting you to the airport and main station.',
  'After a day of sightseeing, unwind on the rooftop terrace with views across the skyline.',
];

const FIRST_NAMES = ['Anna', 'Lukas', 'Sophie', 'Jonas', 'Mia', 'Leon', 'Emma', 'Noah', 'Lea', 'Paul', 'Olivia', 'Liam', 'Aarav', 'Sita', 'Hiro', 'Yuki', 'Carlos', 'Lucia', 'Marco', 'Giulia', 'Pierre', 'Chloé', 'James', 'Amelia', 'Fatima', 'Omar'];
const REVIEW_COUNTRIES = ['Germany', 'Austria', 'Switzerland', 'United Kingdom', 'United States', 'France', 'Italy', 'Spain', 'Nepal', 'India', 'Japan', 'Netherlands', 'Canada', 'Australia'];
const REVIEWS_GOOD = [
  ['Fantastic stay', 'Great location, super friendly staff and a really comfortable bed. Would book again!'],
  ['Exceptional', 'Everything was spotless and the breakfast was delicious. Highly recommended.'],
  ['Perfect for a city break', 'Walking distance to everything we wanted to see. Quiet room despite being central.'],
  ['Lovely hotel', 'The room was modern and well equipped. Check-in was quick and easy.'],
  ['Superb', 'Staff went above and beyond to make our anniversary special. Thank you!'],
];
const REVIEWS_OK = [
  ['Good value', 'Decent room for the price. A bit small, but clean and well located.'],
  ['Pleasant', 'Nice stay overall. WiFi was a little slow in the evenings.'],
  ['Solid choice', 'Comfortable beds and helpful reception. Breakfast could have more variety.'],
];
const REVIEWS_BAD = [
  ['Could be better', 'Location is good but the room was noisy and the shower pressure was weak.'],
  ['Average', 'Fine for one night, but the room looked dated compared to the photos.'],
];

function seed(db) {
  const rand = mulberry32(20240607);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
  const weighted = (pairs) => {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
    return pairs[0][0];
  };
  const sample = (arr, n) => {
    const copy = arr.slice();
    const out = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
    return out;
  };

  const insertHotel = db.prepare(`INSERT INTO hotels
    (name, city, country, address, property_type, stars, description, lat, lng, distance_km, amenities, images, free_cancellation, breakfast_included)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertRoom = db.prepare(`INSERT INTO room_types
    (hotel_id, name, description, beds, max_guests, size_sqm, price_per_night, total_rooms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertReview = db.prepare(`INSERT INTO reviews
    (hotel_id, author_name, author_country, rating, title, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  db.exec('BEGIN');
  try {
    let imageCounter = 0;
    for (const c of CITIES) {
      const usedNames = new Set();
      const count = int(6, 9);
      for (let i = 0; i < count; i++) {
        const type = weighted(TYPE_WEIGHTS);
        let name;
        do { name = `${pick(NAME_PREFIX)} ${c.city} ${pick(NAME_SUFFIX[type])}`; } while (usedNames.has(name));
        usedNames.add(name);

        const stars = type === 'Hostel' ? int(1, 2)
          : type === 'Guesthouse' ? int(2, 3)
          : type === 'Apartment' ? int(3, 4)
          : type === 'Resort' ? int(4, 5)
          : int(3, 5);
        const dist = Math.round((0.2 + rand() * 6) * 10) / 10;
        const angle = rand() * Math.PI * 2;
        const lat = c.lat + Math.sin(angle) * dist / 111;
        const lng = c.lng + Math.cos(angle) * dist / (111 * Math.cos(c.lat * Math.PI / 180));
        const street = pick(c.streets);
        const address = `${street} ${int(1, 180)}, ${c.city}, ${c.country}`;
        const amenities = sample(AMENITIES, int(5, 11));
        if (!amenities.includes('Free WiFi') && rand() < 0.85) amenities.unshift('Free WiFi');
        if (type === 'Apartment' && !amenities.includes('Kitchen')) amenities.push('Kitchen');
        if (stars >= 5 && !amenities.includes('Spa')) amenities.push('Spa');

        const description = [pick(DESCRIPTIONS), pick(DESC_EXTRA), pick(DESC_EXTRA)]
          .filter((v, idx, a) => a.indexOf(v) === idx)
          .join(' ')
          .replaceAll('{city}', c.city).replaceAll('{name}', name)
          .replaceAll('{dist}', String(dist)).replaceAll('{street}', street);

        const images = Array.from({ length: 5 }, () => `https://picsum.photos/seed/hotelsucher-${++imageCounter}/960/640`);
        const freeCancel = rand() < 0.7 ? 1 : 0;
        const breakfast = rand() < 0.4 ? 1 : 0;

        const { lastInsertRowid: hotelId } = insertHotel.run(
          name, c.city, c.country, address, type, stars, description,
          Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, dist,
          JSON.stringify(amenities), JSON.stringify(images), freeCancel, breakfast,
        );

        // Room types
        const base = (type === 'Hostel' ? 28 : type === 'Guesthouse' ? 55 : 45 + stars * 22) * c.priceFactor * (0.85 + rand() * 0.3);
        let templates;
        if (type === 'Hostel') templates = [ROOM_TEMPLATES[0], ROOM_TEMPLATES[2], ROOM_TEMPLATES[4]];
        else if (type === 'Apartment') templates = [ROOM_TEMPLATES[1], ROOM_TEMPLATES[4], ROOM_TEMPLATES[5]];
        else {
          templates = ROOM_TEMPLATES.filter((t, idx) => idx < 5 || stars >= 4);
          templates = sample(templates, int(3, Math.min(5, templates.length)));
          templates.sort((a, b) => a.mult - b.mult);
        }
        for (const t of templates) {
          const price = Math.round(base * t.mult);
          insertRoom.run(hotelId, t.name, t.desc, t.beds, t.max, t.size + int(-2, 4), price, int(2, 8));
        }

        // Reviews: quality correlates loosely with stars
        const reviewCount = int(3, 9);
        for (let r = 0; r < reviewCount; r++) {
          const q = rand() + (stars - 3) * 0.12;
          let rating, text;
          if (q > 0.45) { rating = int(8, 10); text = pick(REVIEWS_GOOD); }
          else if (q > 0.12) { rating = int(6, 8); text = pick(REVIEWS_OK); }
          else { rating = int(3, 6); text = pick(REVIEWS_BAD); }
          const daysAgo = int(3, 400);
          const created = new Date(Date.UTC(2026, 9, 1) - daysAgo * 86400000).toISOString().replace('T', ' ').slice(0, 19);
          insertReview.run(hotelId, pick(FIRST_NAMES), pick(REVIEW_COUNTRIES), rating, text[0], text[1], created);
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { seed, CITIES, AMENITIES };
