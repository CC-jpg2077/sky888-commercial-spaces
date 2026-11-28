'use strict';

const express = require('express');
const multer = require('multer');
const { getSettings, setSettings } = require('../db');
const {
  hashPassword, verifyPassword, DUMMY_HASH, passwordProblem, parseCookies, sha256,
  createSession, destroySession, setSessionCookie, clearSessionCookie,
  requireAdmin, COOKIE_NAME
} = require('../auth');
const { ah, toId } = require('../async');
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

  // Id from the URL, or a 404 if it is not a valid id.
  function idOr404(value, what) {
    const id = toId(value);
    if (!id) throw httpError(404, `${what} not found.`);
    return id;
  }

  // ---- session ------------------------------------------------------------

  router.post('/login', ah(async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const ipKey = `ip:${req.ip}`;
    const emailKey = `em:${email}`;
    const blocked = [loginLimiter.check(ipKey), loginLimiter.check(emailKey)].find((r) => !r.ok);
    if (blocked) {
      res.set('Retry-After', String(blocked.retryAfter));
      throw httpError(429, 'Too many login attempts. Please wait a few minutes and try again.');
    }

    const admin = email ? await db.one('SELECT * FROM admins WHERE lower(email) = $1', [email]) : null;
    const ok = verifyPassword(password, admin ? admin.password_hash : DUMMY_HASH) && !!admin;
    if (!ok) {
      loginLimiter.hit(ipKey);
      loginLimiter.hit(emailKey);
      throw httpError(401, 'Incorrect email or password.');
    }
    loginLimiter.reset(emailKey);
    await db.query('UPDATE admins SET last_login = now() WHERE id = $1', [admin.id]);
    setSessionCookie(req, res, await createSession(db, admin.id));
    res.json({ admin: { name: admin.name, email: admin.email, must_change_password: !!admin.must_change_password } });
  }));

  router.post('/logout', ah(async (req, res) => {
    await destroySession(db, parseCookies(req.headers.cookie)[COOKIE_NAME]);
    clearSessionCookie(res);
    res.json({ ok: true });
  }));

  router.get('/me', authedAllowMust, (req, res) => {
    const a = req.admin;
    res.json({ admin: { name: a.name, email: a.email, must_change_password: !!a.must_change_password } });
  });

  router.post('/password', authedAllowMust, ah(async (req, res) => {
    const current = typeof req.body?.current === 'string' ? req.body.current : '';
    const next = typeof req.body?.next === 'string' ? req.body.next : '';
    const row = await db.one('SELECT password_hash FROM admins WHERE id = $1', [req.admin.id]);
    if (!verifyPassword(current, row.password_hash)) throw httpError(400, 'Your current password is not correct.');
    const problem = passwordProblem(next);
    if (problem) throw httpError(400, problem);
    if (next === current) throw httpError(400, 'Choose a password different from the current one.');
    await db.tx(async (tx) => {
      await tx.query('UPDATE admins SET password_hash = $1, must_change_password = FALSE WHERE id = $2',
        [hashPassword(next), req.admin.id]);
      // Sign out every other device.
      await tx.query('DELETE FROM sessions WHERE admin_id = $1 AND token_hash != $2',
        [req.admin.id, sha256(req.sessionToken)]);
    });
    res.json({ ok: true });
  }));

  // Everything below needs a fully set-up admin.
  router.use(authed);

  // ---- dashboard ----------------------------------------------------------

  router.get('/summary', ah(async (req, res) => {
    const counts = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0]));
    for (const r of await db.all('SELECT status, COUNT(*) AS n FROM requests GROUP BY status')) counts[r.status] = r.n;
    const { n } = await db.one("SELECT COUNT(*) AS n FROM spaces WHERE status = 'available'");
    res.json({ ...counts, available_spaces: n });
  }));

  // ---- requests -----------------------------------------------------------

  router.get('/requests', ah(async (req, res) => {
    const where = [];
    const params = [];
    const status = String(req.query.status || '');
    if (REQUEST_STATUSES.includes(status)) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q) {
      params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      const p = `$${params.length}`;
      where.push(`(reference_no ILIKE ${p} OR business_name ILIKE ${p} OR contact_name ILIKE ${p}
                   OR space_name ILIKE ${p} OR email ILIKE ${p} OR phone ILIKE ${p})`);
    }
    const rows = await db.all(
      `SELECT id, reference_no, business_name, business_type, contact_name, space_name, status, submitted_at
         FROM requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY submitted_at DESC, id DESC LIMIT 500`,
      params
    );
    res.json({ requests: rows });
  }));

  router.get('/requests/:id', ah(async (req, res) => {
    const id = idOr404(req.params.id, 'Request');
    const r = await db.one(
      `SELECT r.*, a.name AS decided_by_name, s.status AS space_status
         FROM requests r
         LEFT JOIN admins a ON a.id = r.decided_by
         LEFT JOIN spaces s ON s.id = r.space_id
        WHERE r.id = $1`,
      [id]
    );
    if (!r) throw httpError(404, 'Request not found.');
    const events = await db.all(
      'SELECT "at", admin_name, action, note FROM request_events WHERE request_id = $1 ORDER BY id',
      [r.id]
    );
    res.json({ request: r, events });
  }));

  router.post('/requests/:id/decision', ah(async (req, res) => {
    const decision = req.body?.decision;
    if (decision !== 'accepted' && decision !== 'declined') throw httpError(400, 'Choose accept or decline.');
    const note = field(req.body?.note, 'Note', { max: 500 });
    if (note.err) throw httpError(400, note.err);
    const spaceStatus = req.body?.space_status || '';
    if (spaceStatus && !SPACE_STATUSES.includes(spaceStatus)) throw httpError(400, 'Invalid space status.');
    const id = idOr404(req.params.id, 'Request');

    await db.tx(async (tx) => {
      // FOR UPDATE stops two admins from deciding the same request at once.
      const r = await tx.one('SELECT * FROM requests WHERE id = $1 FOR UPDATE', [id]);
      if (!r) throw httpError(404, 'Request not found.');
      if (r.status !== 'pending') throw httpError(409, 'A decision has already been recorded for this request.');
      await tx.query(
        'UPDATE requests SET status = $1, decision_note = $2, decided_at = now(), decided_by = $3 WHERE id = $4',
        [decision, note.v, req.admin.id, r.id]
      );
      const ev = 'INSERT INTO request_events (request_id, admin_id, admin_name, action, note) VALUES ($1, $2, $3, $4, $5)';
      await tx.query(ev, [r.id, req.admin.id, req.admin.name, decision === 'accepted' ? 'Accepted' : 'Declined', note.v]);
      if (spaceStatus && r.space_id) {
        await tx.query('UPDATE spaces SET status = $1, updated_at = now() WHERE id = $2', [spaceStatus, r.space_id]);
        await tx.query(ev, [r.id, req.admin.id, req.admin.name, `${r.space_name} set to ${spaceStatus}`, '']);
      }
    });
    res.json({ ok: true });
  }));

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

  async function loadSpace(id) {
    const s = await db.one('SELECT * FROM spaces WHERE id = $1', [id]);
    if (!s) return null;
    s.photos = (await db.all('SELECT id FROM space_photos WHERE space_id = $1 ORDER BY id', [id])).map((p) => p.id);
    return s;
  }

  router.get('/spaces', ah(async (req, res) => {
    const spaces = await db.all(
      `SELECT s.*, (SELECT COUNT(*) FROM requests r WHERE r.space_id = s.id AND r.status = 'pending') AS pending_requests
         FROM spaces s ORDER BY s.sort_order, s.id`
    );
    const photos = await db.all('SELECT id, space_id FROM space_photos ORDER BY id');
    for (const s of spaces) s.photos = photos.filter((p) => p.space_id === s.id).map((p) => p.id);
    res.json({ spaces });
  }));

  router.get('/spaces/:id', ah(async (req, res) => {
    const s = await loadSpace(idOr404(req.params.id, 'Space'));
    if (!s) throw httpError(404, 'Space not found.');
    res.json({ space: s });
  }));

  router.post('/spaces', ah(async (req, res) => {
    const v = spaceFromBody(req.body);
    const { m } = await db.one('SELECT COALESCE(MAX(sort_order), 0) AS m FROM spaces');
    const row = await db.one(
      `INSERT INTO spaces (name, floor, size_sqm, monthly_rate, description, status, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [v.name, v.floor, v.size_sqm, v.monthly_rate, v.description, v.status, m + 1]
    );
    res.status(201).json({ space: await loadSpace(row.id) });
  }));

  router.put('/spaces/:id', ah(async (req, res) => {
    const id = idOr404(req.params.id, 'Space');
    if (!(await loadSpace(id))) throw httpError(404, 'Space not found.');
    const v = spaceFromBody(req.body);
    await db.query(
      `UPDATE spaces SET name = $1, floor = $2, size_sqm = $3, monthly_rate = $4, description = $5, status = $6,
              updated_at = now() WHERE id = $7`,
      [v.name, v.floor, v.size_sqm, v.monthly_rate, v.description, v.status, id]
    );
    res.json({ space: await loadSpace(id) });
  }));

  // Quick status change from the list.
  router.patch('/spaces/:id/status', ah(async (req, res) => {
    const id = idOr404(req.params.id, 'Space');
    const status = req.body?.status;
    if (!SPACE_STATUSES.includes(status)) throw httpError(400, 'Invalid status.');
    const info = await db.query('UPDATE spaces SET status = $1, updated_at = now() WHERE id = $2', [status, id]);
    if (!info.rowCount) throw httpError(404, 'Space not found.');
    res.json({ space: await loadSpace(id) });
  }));

  router.delete('/spaces/:id', ah(async (req, res) => {
    const info = await db.query('DELETE FROM spaces WHERE id = $1', [idOr404(req.params.id, 'Space')]);
    if (!info.rowCount) throw httpError(404, 'Space not found.');
    res.json({ ok: true });
  }));

  router.post('/spaces/:id/photos', upload.array('photos', 8), ah(async (req, res) => {
    const id = idOr404(req.params.id, 'Space');
    if (!(await loadSpace(id))) throw httpError(404, 'Space not found.');
    const files = req.files || [];
    if (!files.length) throw httpError(400, 'Choose at least one photo.');
    const { n } = await db.one('SELECT COUNT(*) AS n FROM space_photos WHERE space_id = $1', [id]);
    if (n + files.length > MAX_PHOTOS_PER_SPACE) {
      throw httpError(400, `A space can have up to ${MAX_PHOTOS_PER_SPACE} photos.`);
    }
    const checked = files.map((f) => ({ mime: sniffImage(f.buffer), data: f.buffer, name: f.originalname }));
    const bad = checked.find((c) => !c.mime);
    if (bad) throw httpError(400, 'Photos must be JPG, PNG or WebP images.');
    await db.tx(async (tx) => {
      for (const c of checked) {
        await tx.query('INSERT INTO space_photos (space_id, mime, data) VALUES ($1, $2, $3)', [id, c.mime, c.data]);
      }
    });
    res.status(201).json({ space: await loadSpace(id) });
  }));

  router.delete('/photos/:id', ah(async (req, res) => {
    const id = idOr404(req.params.id, 'Photo');
    const row = await db.one('SELECT space_id FROM space_photos WHERE id = $1', [id]);
    if (!row) throw httpError(404, 'Photo not found.');
    await db.query('DELETE FROM space_photos WHERE id = $1', [id]);
    res.json({ space: await loadSpace(row.space_id) });
  }));

  // ---- site settings (contact details the client has not supplied yet) ----

  router.get('/settings', ah(async (req, res) => {
    const s = await getSettings(db);
    res.json({ settings: { ...s, show_rates: s.show_rates === '1' } });
  }));

  router.put('/settings', ah(async (req, res) => {
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
    await setSettings(db, {
      address: address.v,
      contact_phone: normalizedPhone,
      contact_email: email.v,
      office_hours: hours.v,
      directions_url: url.v,
      show_rates: b.show_rates ? '1' : '0'
    });
    const s = await getSettings(db);
    res.json({ settings: { ...s, show_rates: s.show_rates === '1' } });
  }));

  return router;
};
