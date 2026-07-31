/* =============================================================
   db.js
   Opens (creating if needed) the SQLite database file that backs
   the Work Orders module, and ensures the work_orders table exists.
   The single place the schema is defined — server.js never runs
   raw DDL itself.
   ============================================================= */

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'operations-portal.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS work_orders (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    title             TEXT NOT NULL,
    description       TEXT NOT NULL,
    location          TEXT NOT NULL,
    category          TEXT NOT NULL,
    priority          TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'New',
    requester_name    TEXT NOT NULL,
    requester_email   TEXT NOT NULL,
    assigned_to       TEXT,
    notes             TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS locations (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS categories (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS assignees (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE
  );
`);

// Seeds the Category list with the original fixed set on first run only —
// admins can rename/remove/add to it from here on via /api/categories.
// Locations and assignees start empty; facility staff add their own
// through the admin page since those are site-specific.
const DEFAULT_CATEGORIES = ['Electrical', 'Plumbing', 'HVAC', 'Grounds', 'Structural', 'IT', 'Other'];
const categoryCount = db.prepare('SELECT COUNT(*) AS count FROM categories').get().count;
if (categoryCount === 0) {
  const insertCategory = db.prepare('INSERT INTO categories (name) VALUES (?)');
  const seed = db.transaction((names) => {
    names.forEach((name) => insertCategory.run(name));
  });
  seed(DEFAULT_CATEGORIES);
}

module.exports = db;
