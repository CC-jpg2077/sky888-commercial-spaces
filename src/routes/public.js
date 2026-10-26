'use strict';

const express = require('express');
const { getSettings } = require('../db');
const { field, isEmail, isPhone, createLimiter, httpError } = require('../util');

// A real calendar date in YYYY-MM-DD form that is not before today
// (yesterday is allowed so time zones never reject a valid "today").
function isFutureDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
  return d.getTime() >= Date.now() - 36 * 3600 * 1000;
}

const PHOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

module.exports = function publicRoutes(db) {
  const router = express.Router();
  // Five requests per hour per visitor is plenty for real use and slows spam.
  const submitLimiter = createLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

  // Everything the public page needs in one call.
  router.get('/site', (req, res) => {
    const s = getSettings(db);
    const showRates = s.show_rates === '1';
    const photos = db.prepare('SELECT id, space_id FROM space_photos ORDER BY id').all();
    const byspace = new Map();
    for (const p of photos) {
      if (!byspace.has(p.space_id)) byspace.set(p.space_id, []);
      byspace.get(p.space_id).push(p.id);
    }
    const spaces = db.prepare('SELECT * FROM spaces ORDER BY sort_order, id').all().map((sp) => ({
      id: sp.id,
      name: sp.name,
      floor: sp.floor,
      size_sqm: sp.size_sqm,
      monthly_rate: showRates ? sp.monthly_rate : null,
      description: sp.description,
      status: sp.status,
      photos: byspace.get(sp.id) || []
    }));
    res.set('Cache-Control', 'no-store');
    res.json({
      settings: {
        address: s.address,
        contact_phone: s.contact_phone,
        contact_email: s.contact_email,
        office_hours: s.office_hours,
        directions_url: s.directions_url
      },
      spaces
    });
  });

  router.get('/photos/:id', (req, res) => {
    const row = db.prepare('SELECT mime, data FROM space_photos WHERE id = ?').get(Number(req.params.id));
    if (!row || !PHOTO_MIMES.has(row.mime)) return res.status(404).json({ error: 'Not found.' });
    res.set('Content-Type', row.mime);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(row.data);
  });

  router.post('/requests', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    // Hidden field that real visitors never fill in. Pretend it worked.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return res.status(201).json({ reference_no: 'SKY-0000' });
    }

    const limit = submitLimiter.check(req.ip);
    if (!limit.ok) {
      res.set('Retry-After', String(limit.retryAfter));
      throw httpError(429, 'Too many requests from this device. Please try again later.');
    }

    const fields = {};
    const biz = field(body.business_name, 'Business name', { required: true, max: 120 });
    const type = field(body.business_type, 'Business type', { required: true, max: 120 });
    const desc = field(body.business_description, 'Business description', { max: 1000 });
    const start = field(body.target_start_date, 'Target start date', { max: 10 });
    const contact = field(body.contact_name, 'Contact person', { required: true, max: 120 });
    const phone = field(body.phone, 'Phone number', { required: true, max: 40 });
    const email = field(body.email, 'Email', { required: true, max: 254 });
    const notes = field(body.notes, 'Notes', { max: 1000 });
    for (const [k, f] of Object.entries({
      business_name: biz, business_type: type, business_description: desc, target_start_date: start,
      contact_name: contact, phone, email, notes
    })) if (f.err) fields[k] = f.err;
    if (!fields.target_start_date && start.v && !isFutureDate(start.v)) {
      fields.target_start_date = 'Choose today or a later date.';
    }
    if (!fields.phone && !isPhone(phone.v)) fields.phone = 'Enter a valid phone number.';
    if (!fields.email && !isEmail(email.v)) fields.email = 'Enter a valid email address.';

    const spaceId = Number(body.space_id);
    const space = Number.isInteger(spaceId)
      ? db.prepare('SELECT id, name, status FROM spaces WHERE id = ?').get(spaceId)
      : null;
    if (!space) fields.space_id = 'Choose a space.';
    else if (space.status !== 'available') fields.space_id = 'That space is no longer open for requests.';

    if (Object.keys(fields).length) {
      throw httpError(422, 'Please fix the highlighted fields.', { fields });
    }

    const insert = db.transaction(() => {
      const info = db.prepare(
        `INSERT INTO requests (space_id, space_name, business_name, business_type, business_description,
                               target_start_date, contact_name, phone, email, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(space.id, space.name, biz.v, type.v, desc.v, start.v || null, contact.v, phone.v, email.v, notes.v);
      const id = Number(info.lastInsertRowid);
      const ref = `SKY-${1000 + id}`;
      db.prepare('UPDATE requests SET reference_no = ? WHERE id = ?').run(ref, id);
      db.prepare('INSERT INTO request_events (request_id, action) VALUES (?, ?)').run(id, 'Request submitted');
      return ref;
    });

    const reference_no = insert();
    submitLimiter.hit(req.ip);
    res.status(201).json({ reference_no });
  });

  return router;
};
