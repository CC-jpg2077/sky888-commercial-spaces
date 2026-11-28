'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'sky_admin';
const SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Used so a login for an unknown email takes as long as a real one.
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Password must be at least 10 characters.';
  if (password.length > 200) return 'Password must be 200 characters or fewer.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Password must contain at least one letter and one number.';
  return null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  }
  return out;
}

async function createSession(db, adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query('DELETE FROM sessions WHERE expires_at < $1', [Date.now()]);
  await db.query(
    'INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES ($1, $2, $3)',
    [sha256(token), adminId, Date.now() + SESSION_MS]
  );
  return token;
}

async function destroySession(db, token) {
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

function setSessionCookie(req, res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_MS,
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

async function findAdminByToken(db, token) {
  if (!token) return null;
  const row = await db.one(
    `SELECT a.id, a.email, a.name, a.must_change_password, s.expires_at
       FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = $1`,
    [sha256(token)]
  );
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    await destroySession(db, token);
    return null;
  }
  return row;
}

// Express middleware. While an admin still has the temporary password, only
// routes that opt in with allowMustChange can be used.
function requireAdmin(db, { allowMustChange = false } = {}) {
  return async (req, res, next) => {
    try {
      const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
      const admin = await findAdminByToken(db, token);
      if (!admin) return res.status(401).json({ error: 'Please log in.', code: 'login_required' });
      if (admin.must_change_password && !allowMustChange) {
        return res.status(403).json({ error: 'Set a new password before continuing.', code: 'must_change_password' });
      }
      req.admin = admin;
      req.sessionToken = token;
      next();
    } catch (err) {
      next(err);
    }
  };
}

async function createAdmin(db, { email, name, password, mustChange = true }) {
  const row = await db.one(
    'INSERT INTO admins (email, name, password_hash, must_change_password) VALUES ($1, $2, $3, $4) RETURNING id',
    [email, name, hashPassword(password), !!mustChange]
  );
  return row.id;
}

// First run only: make sure at least one admin exists.
async function bootstrapAdmin(db, log = console.log) {
  const { n } = await db.one('SELECT COUNT(*) AS n FROM admins');
  if (n > 0) return null;
  const email = (process.env.ADMIN_EMAIL || 'admin@sky888.local').trim();
  let password = process.env.ADMIN_PASSWORD;
  const generated = !password;
  if (generated) password = crypto.randomBytes(9).toString('base64url') + '7';
  await createAdmin(db, { email, name: 'Administrator', password, mustChange: true });
  log('------------------------------------------------------------');
  log(' First run: admin account created.');
  log(`   Email:    ${email}`);
  log(generated ? `   Password: ${password}   (shown once; you must change it at first login)`
                : '   Password: the ADMIN_PASSWORD you set (you must change it at first login)');
  log('------------------------------------------------------------');
  return { email, password: generated ? password : null };
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  DUMMY_HASH,
  passwordProblem,
  parseCookies,
  sha256,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  requireAdmin,
  createAdmin,
  bootstrapAdmin
};
