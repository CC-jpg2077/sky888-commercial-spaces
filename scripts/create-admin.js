'use strict';

// Usage: node scripts/create-admin.js <email> [name]
// Creates an admin, or resets the password of an existing one.
// Set ADMIN_PASSWORD to choose the password; otherwise one is generated and
// printed once. The admin must change it at first login.

const crypto = require('crypto');
const { openDb } = require('../src/db');
const { createAdmin, hashPassword } = require('../src/auth');

const email = (process.argv[2] || '').trim();
const name = (process.argv[3] || 'Administrator').trim();
if (!email) {
  console.error('Usage: node scripts/create-admin.js <email> [name]');
  process.exit(1);
}

const db = openDb();
let password = process.env.ADMIN_PASSWORD;
const generated = !password;
if (generated) password = crypto.randomBytes(9).toString('base64url') + '7';

const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
if (existing) {
  db.transaction(() => {
    db.prepare('UPDATE admins SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hashPassword(password), existing.id);
    db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(existing.id);
  })();
  console.log(`Password reset for ${email}.`);
} else {
  createAdmin(db, { email, name, password, mustChange: true });
  console.log(`Admin created: ${email}`);
}
if (generated) console.log(`Temporary password: ${password}   (shown once; it must be changed at first login)`);
db.close();
