# HotelSucher

A hotel search and booking website, inspired by sites like Booking.com. It is a full-stack app:
a Node.js + Express API, a SQLite database and a single-page front-end in plain JavaScript.
There is no build step.

## Features

- **Search** about 120 demo properties in 16 cities (Berlin, Paris, Tokyo, Kathmandu, …), with destination autocomplete, dates, guests and rooms.
- **Filters and sorting**: budget, free cancellation, breakfast, distance, review score, star rating, property type and facilities. Sort by price, rating, stars or distance. Results are paginated.
- **Live availability**: each room type has a fixed number of rooms. Availability is checked night by night against existing bookings, so rooms can sell out and double bookings are prevented.
- **Property pages** with a photo gallery and lightbox, facilities, an OpenStreetMap location map, a room table with total prices and guest reviews.
- **Booking flow**: choose a room, enter guest details and get a confirmation with a booking reference (`HSXXXXXXXX`). You can book as a guest or while signed in.
- **Accounts**: register, sign in and sign out. Passwords are hashed with scrypt and sessions use HTTP-only cookies.
- **My bookings**: see upcoming, past and cancelled trips. Bookings with free cancellation can be cancelled before check-in.
- **Find my booking**: guests can look up and cancel a booking with its reference and email address.
- **Saved properties** (wishlist) with the heart button.
- **Reviews**: signed-in guests who booked a property can review it once.
- Minimal, warm design: Manrope for interface text and Instrument Serif for headlines (Google Fonts), with inline SVG line icons. The layout adapts to desktop and mobile.
- **Themes**: Light, Charcoal (warm dark) and Midnight (navy dark), or match the device setting. Pick one from the sun/moon button in the header; the choice is remembered.

> This is a demo. No payment is taken and no real reservations are made.

## Requirements

- Node.js **22.13 or newer**. The app uses the built-in `node:sqlite` module, so you don't need a native database driver.

## Getting started

```bash
npm install
npm start
```

Then open http://localhost:3000.

On first start the database is created at `data/hotelsucher.db` and filled with demo data.

| Command         | What it does                                   |
| --------------- | ---------------------------------------------- |
| `npm start`     | Start the server (port `3000` or `$PORT`)      |
| `npm run dev`   | Start with auto-restart when files change      |
| `npm run seed`  | Delete the database and re-create the demo data |
| `npm test`      | Run the API test suite (uses an in-memory DB)  |

Environment variables: `PORT`, `DB_PATH` (path of the SQLite file) and `NODE_ENV=production` (marks the session cookie as `Secure`).

## Deploy (free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/iamkrish001/Booking.com)

The button uses `render.yaml` to create a free Node web service. On the free plan the service
sleeps after about 15 minutes without visits; the next visit takes up to a minute to wake it.
The disk is not permanent either, so accounts and bookings reset when the service restarts or redeploys.
The demo hotels are re-created automatically.

## Project structure

```
server.js            Entry point
src/app.js           Express app and REST API
src/db.js            SQLite schema and connection
src/seed.js          Deterministic demo data generator
src/seed-cli.js      `npm run seed`
public/index.html    App shell
public/css/          Styles
public/js/app.js     Single-page front-end (hash router and views)
test/api.test.js     API tests (node:test)
```

## API overview

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/destinations` | Cities with property counts |
| GET | `/api/hotels` | Search. Query: `q, checkIn, checkOut, guests, rooms, minPrice, maxPrice, stars, types, amenities, minRating, maxDistance, freeCancellation, breakfast, sort, page` |
| GET | `/api/hotels/:id` | Property details, room availability and reviews |
| POST | `/api/hotels/:id/reviews` | Add a review (signed in, after booking) |
| POST | `/api/bookings` | Create a booking |
| GET | `/api/bookings` | My bookings (signed in) |
| GET | `/api/bookings/:ref?email=` | Look up a booking |
| POST | `/api/bookings/:ref/cancel` | Cancel a booking |
| GET/PUT/DELETE | `/api/wishlist[/:hotelId]` | Saved properties |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Accounts |
| GET | `/api/auth/me` | Current user |

Property photos are placeholder images from picsum.photos. If they can't load, a branded placeholder is shown instead.
