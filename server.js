'use strict';

const { openDatabase } = require('./src/db');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const db = openDatabase();
const app = createApp(db);

const server = app.listen(PORT, () => {
  console.log(`HotelSucher is running at http://localhost:${PORT}`);
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
