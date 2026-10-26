'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS spaces (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  floor INTEGER,
  size_sqm REAL,
  monthly_rate REAL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','occupied')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS space_photos (
  id INTEGER PRIMARY KEY,
  space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  reference_no TEXT UNIQUE,
  space_id INTEGER REFERENCES spaces(id) ON DELETE SET NULL,
  space_name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  business_description TEXT NOT NULL DEFAULT '',
  business_type TEXT NOT NULL DEFAULT '',
  target_start_date TEXT,
  contact_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  decision_note TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL DEFAULT ${NOW},
  decided_at TEXT,
  decided_by INTEGER REFERENCES admins(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_space ON requests(space_id);

CREATE TABLE IF NOT EXISTS request_events (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT ${NOW},
  admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  admin_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_events_request ON request_events(request_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Everything the client has not decided yet lives here, so the admin can
// fill it in without touching code.
const DEFAULT_SETTINGS = {
  address: 'Don Rufino Alonzo Sr. St., Brgy. Poblacion 5, Cotabato City 9600',
  contact_phone: '',
  contact_email: '',
  office_hours: '',
  directions_url: '',
  show_rates: '0'
};

function openDb(file) {
  const target = file || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'sky888.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // Databases created before the redesign lack these two columns.
  const have = new Set(db.prepare('PRAGMA table_info(requests)').all().map((c) => c.name));
  if (!have.has('business_type')) db.exec("ALTER TABLE requests ADD COLUMN business_type TEXT NOT NULL DEFAULT ''");
  if (!have.has('target_start_date')) db.exec('ALTER TABLE requests ADD COLUMN target_start_date TEXT');

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

  return db;
}

function getSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    if (row.key in DEFAULT_SETTINGS) out[row.key] = row.value;
  }
  return out;
}

function setSettings(db, patch) {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (k in DEFAULT_SETTINGS) upsert.run(k, String(v));
    }
  })();
}

// Matches the three cards in the Figma design. Details are left empty on
// purpose: the client has not provided sizes, rates or photos yet.
function seedSampleSpaces(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM spaces').get();
  if (n > 0 || process.env.SEED_SAMPLE === '0') return false;
  const insert = db.prepare(
    'INSERT INTO spaces (name, floor, status, sort_order) VALUES (?, ?, ?, ?)'
  );
  db.transaction(() => {
    insert.run('Unit 1', null, 'available', 1);
    insert.run('Unit 2', null, 'available', 2);
    insert.run('Unit 3', null, 'reserved', 3);
  })();
  return true;
}

module.exports = { openDb, getSettings, setSettings, seedSampleSpaces, DEFAULT_SETTINGS };
