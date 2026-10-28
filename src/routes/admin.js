'use strict';

const express = require('express');
const multer = require('multer');
const { getSettings, setSettings } = require('../db');
const {
  hashPassword, verifyPassword, DUMMY_HASH, passwordProblem, parseCookies,
  createSession, destroySession, setSessionCookie, clearSessionCookie,
  requireAdmin, COOKIE_NAME
} = require('../auth');
const { field, isEmail, normalizePhone, optionalNumber, optionalInt, createLimiter, httpError } = require('../util');

const SPACE_STATUSES = ['available', 'reserved', 'occupied'];
const REQUEST_STATUSES = ['pending', 'accepted', 'declined'];
const MAX_PHOTOS_PER_SPACE = 10;

// Decide the image type from its first bytes, never from what the browser says.
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

module.exports = function adminRoutes(db) {
  const router = express.Router();
  const authed = requireAdmin(db);
  const authedAllowMust = requireAdmin(db, { allowMustChange: true });
  const loginLimiter = createLimiter({ max: 8, windowMs: 15 * 60 * 1000 });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 8 }
  });

  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // ---- session ------------------------------------------------------------

  router.post('/login', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const ipKey = `ip:${req.ip}`;
    const emailKey = `em:${email}`;
    const blocked = [loginLimiter.check(ipKey), loginLimiter.check(emailKey)].find((r) => !r.ok);
    if (blocked) {
      res.set('Retry-After', String(blocked.retryAfter));
      throw httpError(429, 'Too many login attempts. Please wait a few minutes and try again.');
    }

    const admin = email ? db.prepare('SELECT * FROM admins WHERE email = ?').get(email) : null;
    const ok = verifyPassword(password, admin ? admin.password_hash : DUMMY_HASH) && !!admin;
    if (!ok) {
      loginLimiter.hit(ipKey);
      loginLimiter.hit(emailKey);
      throw httpError(401, 'Incorrect email or password.');
    }
    loginLimiter.reset(emailKey);
    db.prepare("UPDATE admins SET last_login = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(admin.id);
    setSessionCookie(req, res, createSession(db, admin.id));
    res.json({ admin: { name: admin.name, email: admin.email, must_change_password: !!admin.must_change_password } });
  });

  router.post('/logout', (req, res) => {
    destroySession(db, parseCookies(req.headers.cookie)[COOKIE_NAME]);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', authedAllowMust, (req, res) => {
    const a = req.admin;
    res.json({ admin: { name: a.name, email: a.email, must_change_password: !!a.must_change_password } });
  });

  router.post('/password', authedAllowMust, (req, res) => {
    const current = typeof req.body?.current === 'string' ? req.body.current : '';
    const next = typeof req.body?.next === 'string' ? req.body.next : '';
    const row = db.prepare('SELECT password_hash FROM admins WHERE id = ?').get(req.admin.id);
    if (!verifyPassword(current, row.password_hash)) throw httpError(400, 'Your current password is not correct.');
    const problem = passwordProblem(next);
    if (problem) throw httpError(400, problem);
    if (next === current) throw httpError(400, 'Choose a password different from the current one.');
    db.transaction(() => {
      db.prepare('UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?')
        .run(hashPassword(next), req.admin.id);
      // Sign out every other device.
      db.prepare('DELETE FROM sessions WHERE admin_id = ? AND token_hash != ?')
        .run(req.admin.id, require('crypto').createHash('sha256').update(req.sessionToken).digest('hex'));
    })();
    res.json({ ok: true });
  });

  // Everything below needs a fully set-up admin.
  router.use(authed);

  // ---- dashboard ----------------------------------------------------------

  router.get('/summary', (req, res) => {
    const counts = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0]));
    for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM requests GROUP BY status').all()) counts[r.status] = r.n;
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM spaces WHERE status = 'available'").get();
    res.json({ ...counts, available_spaces: n });
  });

  // ---- requests -----------------------------------------------------------

  router.get('/requests', (req, res) => {
    const where = [];
    const params = [];
    const status = String(req.query.status || '');
    if (REQUEST_STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(`(reference_no LIKE ? ESCAPE '\\' OR business_name LIKE ? ESCAPE '\\' OR contact_name LIKE ? ESCAPE '\\'
                   OR space_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')`);
      params.push(like, like, like, like, like, like);
    }
    const rows = db.prepare(
      `SELECT id, reference_no, business_name, business_type, contact_name, space_name, status, submitted_at
         FROM requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY submitted_at DESC, id DESC LIMIT 500`
    ).all(...params);
    res.json({ requests: rows });
  });

  router.get('/requests/:id', (req, res) => {
    const r = db.prepare(
      `SELECT r.*, a.name AS decided_by_name, s.status AS space_status
         FROM requests r
         LEFT JOIN admins a ON a.id = r.decided_by
         LEFT JOIN spaces s ON s.id = r.space_id
        WHERE r.id = ?`
    ).get(Number(req.params.id));
    if (!r) throw httpError(404, 'Request not found.');
    const events = db.prepare('SELECT at, admin_name, action, note FROM request_events WHERE request_id = ? ORDER BY id').all(r.id);
    res.json({ request: r, events });
  });

  router.post('/requests/:id/decision', (req, res) => {
    const decision = req.body?.decision;
    if (decision !== 'accepted' && decision !== 'declined') throw httpError(400, 'Choose accept or decline.');
    const note = field(req.body?.note, 'Note', { max: 500 });
    if (note.err) throw httpError(400, note.err);
    const spaceStatus = req.body?.space_status || '';
    if (spaceStatus && !SPACE_STATUSES.includes(spaceStatus)) throw httpError(400, 'Invalid space status.');

    const run = db.transaction(() => {
      const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(req.params.id));
      if (!r) throw httpError(404, 'Request not found.');
      if (r.status !== 'pending') throw httpError(409, 'A decision has already been recorded for this request.');
      db.prepare(
        `UPDATE requests SET status = ?, decision_note = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), decided_by = ?
          WHERE id = ?`
      ).run(decision, note.v, req.admin.id, r.id);
      const ev = db.prepare('INSERT INTO request_events (request_id, admin_id, admin_name, action, note) VALUES (?, ?, ?, ?, ?)');
      ev.run(r.id, req.admin.id, req.admin.name, decision === 'accepted' ? 'Accepted' : 'Declined', note.v);
      if (spaceStatus && r.space_id) {
        db.prepare("UPDATE spaces SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(spaceStatus, r.space_id);
        ev.run(r.id, req.admin.id, req.admin.name, `${r.space_name} set to ${spaceStatus}`, '');
      }
    });
    run();
    res.json({ ok: true });
  });

  // ---- spaces -------------------------------------------------------------

  function spaceFromBody(body) {
    const errors = [];
    const name = field(body?.name, 'Name', { required: true, max: 80 });
    const description = field(body?.description, 'Description', { max: 1000 });
    const floor = optionalInt(body?.floor, 'Floor', { min: 0, max: 50 });
    const size = optionalNumber(body?.size_sqm, 'Size', { max: 100000 });
    const rate = optionalNumber(body?.monthly_rate, 'Monthly rate', { max: 1e8 });
    for (const f of [name, description, floor, size, rate]) if (f.err) errors.push(f.err);
    const status = body?.status === undefined || body?.status === '' ? 'available' : body.status;
    if (!SPACE_STATUSES.includes(status)) errors.push('Invalid status.');
    if (errors.length) throw httpError(422, errors[0], { fields: { _all: errors } });
    return { name: name.v, description: description.v, floor: floor.v, size_sqm: size.v, monthly_rate: rate.v, status };
  }

  function loadSpace(id) {
    const s = db.prepare('SELECT * FROM spaces WHERE id = ?').get(id);
    if (!s) return null;
    s.photos = db.prepare('SELECT id FROM space_photos WHERE space_id = ? ORDER BY id').all(id).map((p) => p.id);
    return s;
  }

  router.get('/spaces', (req, res) => {
    const spaces = db.prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM requests r WHERE r.space_id = s.id AND r.status = 'pending') AS pending_requests
         FROM spaces s ORDER BY s.sort_order, s.id`
    ).all();
    const photos = db.prepare('SELECT id, space_id FROM space_photos ORDER BY id').all();
    for (const s of spaces) s.photos = photos.filter((p) => p.space_id === s.id).map((p) => p.id);
    res.json({ spaces });
  });

  router.get('/spaces/:id', (req, res) => {
    const s = loadSpace(Number(req.params.id));
    if (!s) throw httpError(404, 'Space not found.');
    res.json({ space: s });
  });

  router.post('/spaces', (req, res) => {
    const v = spaceFromBody(req.body);
    const { m } = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM spaces').get();
    const info = db.prepare(
      'INSERT INTO spaces (name, floor, size_sqm, monthly_rate, description, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(v.name, v.floor, v.size_sqm, v.monthly_rate, v.description, v.status, m + 1);
    res.status(201).json({ space: loadSpace(Number(info.lastInsertRowid)) });
  });

  router.put('/spaces/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!loadSpace(id)) throw httpError(404, 'Space not found.');
    const v = spaceFromBody(req.body);
    db.prepare(
      `UPDATE spaces SET name = ?, floor = ?, size_sqm = ?, monthly_rate = ?, description = ?, status = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).run(v.name, v.floor, v.size_sqm, v.monthly_rate, v.description, v.status, id);
    res.json({ space: loadSpace(id) });
  });

  // Quick status change from the list.
  router.patch('/spaces/:id/status', (req, res) => {
    const id = Number(req.params.id);
    const status = req.body?.status;
    if (!SPACE_STATUSES.includes(status)) throw httpError(400, 'Invalid status.');
    const info = db.prepare(
      "UPDATE spaces SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ).run(status, id);
    if (!info.changes) throw httpError(404, 'Space not found.');
    res.json({ space: loadSpace(id) });
  });

  router.delete('/spaces/:id', (req, res) => {
    const info = db.prepare('DELETE FROM spaces WHERE id = ?').run(Number(req.params.id));
    if (!info.changes) throw httpError(404, 'Space not found.');
    res.json({ ok: true });
  });

  router.post('/spaces/:id/photos', upload.array('photos', 8), (req, res) => {
    const id = Number(req.params.id);
    if (!loadSpace(id)) throw httpError(404, 'Space not found.');
    const files = req.files || [];
    if (!files.length) throw httpError(400, 'Choose at least one photo.');
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM space_photos WHERE space_id = ?').get(id);
    if (n + files.length > MAX_PHOTOS_PER_SPACE) {
      throw httpError(400, `A space can have up to ${MAX_PHOTOS_PER_SPACE} photos.`);
    }
    const checked = files.map((f) => ({ mime: sniffImage(f.buffer), data: f.buffer, name: f.originalname }));
    const bad = checked.find((c) => !c.mime);
    if (bad) throw httpError(400, 'Photos must be JPG, PNG or WebP images.');
    const insert = db.prepare('INSERT INTO space_photos (space_id, mime, data) VALUES (?, ?, ?)');
    db.transaction(() => { for (const c of checked) insert.run(id, c.mime, c.data); })();
    res.status(201).json({ space: loadSpace(id) });
  });

  router.delete('/photos/:id', (req, res) => {
    const row = db.prepare('SELECT space_id FROM space_photos WHERE id = ?').get(Number(req.params.id));
    if (!row) throw httpError(404, 'Photo not found.');
    db.prepare('DELETE FROM space_photos WHERE id = ?').run(Number(req.params.id));
    res.json({ space: loadSpace(row.space_id) });
  });

  // ---- site settings (contact details the client has not supplied yet) ----

  router.get('/settings', (req, res) => {
    const s = getSettings(db);
    res.json({ settings: { ...s, show_rates: s.show_rates === '1' } });
  });

  router.put('/settings', (req, res) => {
    const b = req.body || {};
    const address = field(b.address, 'Address', { required: true, max: 200 });
    const phone = field(b.contact_phone, 'Phone number', { max: 60 });
    const email = field(b.contact_email, 'Email', { max: 254 });
    const hours = field(b.office_hours, 'Office hours', { max: 200 });
    const url = field(b.directions_url, 'Directions link', { max: 500 });
    const err = [address, phone, email, hours, url].find((f) => f.err);
    if (err) throw httpError(422, err.err);
    const normalizedPhone = phone.v ? normalizePhone(phone.v) : '';
    if (phone.v && !normalizedPhone) throw httpError(422, 'Enter a valid phone number.');
    if (email.v && !isEmail(email.v)) throw httpError(422, 'Enter a valid email address.');
    if (url.v && !/^https:\/\/[^\s]+$/i.test(url.v)) throw httpError(422, 'The directions link must start with https://');
    setSettings(db, {
      address: address.v,
      contact_phone: normalizedPhone,
      contact_email: email.v,
      office_hours: hours.v,
      directions_url: url.v,
      show_rates: b.show_rates ? '1' : '0'
    });
    const s = getSettings(db);
    res.json({ settings: { ...s, show_rates: s.show_rates === '1' } });
  });

  return router;
};
