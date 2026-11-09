'use strict';
// Re-creates the database from scratch with demo data.
const fs = require('node:fs');
const path = require('node:path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'hotelsucher.db');
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
const { openDatabase } = require('./db');
const db = openDatabase(dbPath);
const { n } = db.prepare('SELECT COUNT(*) AS n FROM hotels').get();
console.log(`Database reset at ${dbPath} with ${n} properties.`);
db.close();
