'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { openDb, seedSampleSpaces } = require('../src/db');
const { createAdmin } = require('../src/auth');
const { createApp } = require('../src/app');

const TEMP_PW = 'Temporary123';
const NEW_PW = 'BetterPass2026';

let server, base, cookie = '';

function call(method, url, { body, headers = {}, auth = true, form } = {}) {
  const h = { ...headers };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (auth && cookie) h.Cookie = cookie;
  return fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' }).then(async (r) => {
    let data = null;
    const type = r.headers.get('content-type') || '';
    if (type.includes('json')) data = await r.json();
    return { status: r.status, data, res: r };
  });
}

const goodRequest = (space_id, over = {}) => ({
  business_name: 'Mabuhay Print & Copy',
  business_type: 'Printing and school supplies',
  target_start_date: '2099-01-15',
  space_id,
  contact_name: 'Maria Santos',
  phone: '0917 123 4567',
  email: 'maria@example.com',
  notes: '',
  ...over
});

test.before(async () => {
  const db = openDb(':memory:');
  seedSampleSpaces(db);
  createAdmin(db, { email: 'admin@test.local', name: 'Test Admin', password: TEMP_PW, mustChange: true });
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('public site lists the sample spaces', async () => {
  const { status, data } = await call('GET', '/api/site', { auth: false });
  assert.equal(status, 200);
  assert.deepEqual(data.spaces.map((s) => [s.name, s.status]), [['Unit 1', 'available'], ['Unit 2', 'available'], ['Unit 3', 'reserved']]);
  assert.match(data.settings.address, /Don Rufino Alonzo/);
  assert.equal('show_rates' in data.settings, false);
});

test('the homepage and admin page are served', async () => {
  for (const p of ['/', '/admin/', '/css/site.css', '/js/site.js', '/img/building.png']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
  }
});

test('request form: validation errors name each field', async () => {
  const headers = { 'X-Forwarded-For': '10.0.0.1' };
  const { status, data } = await call('POST', '/api/requests', { body: { business_name: ' ' }, headers, auth: false });
  assert.equal(status, 422);
  for (const k of ['business_name', 'business_type', 'contact_name', 'phone', 'email', 'space_id']) assert.ok(data.fields[k], k);
  const bad = await call('POST', '/api/requests', { body: goodRequest(1, { email: 'nope', phone: 'abc' }), headers, auth: false });
  assert.equal(bad.status, 422);
  assert.ok(bad.data.fields.email && bad.data.fields.phone);
});

test('request form: reserved or unknown spaces are refused', async () => {
  const headers = { 'X-Forwarded-For': '10.0.0.2' };
  assert.equal((await call('POST', '/api/requests', { body: goodRequest(3), headers, auth: false })).status, 422);
  assert.equal((await call('POST', '/api/requests', { body: goodRequest(999), headers, auth: false })).status, 422);
});

test('request form: honeypot is silently ignored', async () => {
  const r = await call('POST', '/api/requests', {
    body: goodRequest(1, { website: 'http://spam' }),
    headers: { 'X-Forwarded-For': '10.0.0.5' },
    auth: false
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.reference_no, 'SKY-0000');
});

test('request form: invalid attempts consume the spam quota', async () => {
  const headers = { 'X-Forwarded-For': '10.0.0.6' };
  for (let i = 0; i < 3; i++) {
    assert.equal((await call('POST', '/api/requests', { body: {}, headers, auth: false })).status, 422);
  }
  const blocked = await call('POST', '/api/requests', { body: {}, headers, auth: false });
  assert.equal(blocked.status, 429);
  assert.match(blocked.data.error, /Too many requests/);
  assert.ok(Number(blocked.res.headers.get('retry-after')) > 0);
});

test('request form: retry delay covers the longest exhausted window', async () => {
  const headers = { 'X-Forwarded-For': '10.0.0.61' };
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    for (let i = 0; i < 3; i++) {
      assert.equal((await call('POST', '/api/requests', { body: {}, headers, auth: false })).status, 422);
    }
    now += 10 * 60 * 1000 + 1000;
    for (let i = 0; i < 2; i++) {
      assert.equal((await call('POST', '/api/requests', { body: {}, headers, auth: false })).status, 422);
    }
    const blocked = await call('POST', '/api/requests', { body: {}, headers, auth: false });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.res.headers.get('retry-after')) > 2800);
  } finally {
    Date.now = realNow;
  }
});

test('request form: honeypot attempts cannot bypass the spam quota', async () => {
  const headers = { 'X-Forwarded-For': '10.0.0.7' };
  for (let i = 0; i < 3; i++) {
    assert.equal((await call('POST', '/api/requests', {
      body: goodRequest(1, { website: 'http://spam' }),
      headers,
      auth: false
    })).status, 201);
  }
  assert.equal((await call('POST', '/api/requests', {
    body: goodRequest(1, { website: 'http://spam' }),
    headers,
    auth: false
  })).status, 429);
});

test('request form: a valid request gets a reference number', async () => {
  const r = await call('POST', '/api/requests', {
    body: goodRequest(1),
    headers: { 'X-Forwarded-For': '10.0.0.8' },
    auth: false
  });
  assert.equal(r.status, 201);
  assert.match(r.data.reference_no, /^SKY-\d{4}$/);
  const r2 = await call('POST', '/api/requests', {
    body: goodRequest(2, { business_name: 'Cruz Tutorial Center' }),
    headers: { 'X-Forwarded-For': '10.0.0.9' },
    auth: false
  });
  assert.notEqual(r.data.reference_no, r2.data.reference_no);
});

test('admin API needs a login', async () => {
  for (const [m, u] of [['GET', '/api/admin/summary'], ['GET', '/api/admin/requests'], ['GET', '/api/admin/spaces'], ['PUT', '/api/admin/settings']]) {
    const r = await call(m, u, { auth: false, body: m === 'PUT' ? {} : undefined });
    assert.equal(r.status, 401, u);
  }
});

test('login: wrong password is refused, right one works', async () => {
  assert.equal((await call('POST', '/api/admin/login', { body: { email: 'admin@test.local', password: 'wrong' }, auth: false })).status, 401);
  assert.equal((await call('POST', '/api/admin/login', { body: { email: 'nobody@test.local', password: 'wrong' }, auth: false })).status, 401);
  const ok = await call('POST', '/api/admin/login', { body: { email: 'ADMIN@test.local', password: TEMP_PW }, auth: false });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.admin.must_change_password, true);
  const setCookie = ok.res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  cookie = setCookie.split(';')[0];
});

test('temporary password must be changed before anything else', async () => {
  const blocked = await call('GET', '/api/admin/summary');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'must_change_password');
  assert.equal((await call('POST', '/api/admin/password', { body: { current: TEMP_PW, next: 'short1' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/password', { body: { current: TEMP_PW, next: 'onlyletterslong' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/password', { body: { current: 'nope', next: NEW_PW } })).status, 400);
  assert.equal((await call('POST', '/api/admin/password', { body: { current: TEMP_PW, next: NEW_PW } })).status, 200);
  assert.equal((await call('GET', '/api/admin/summary')).status, 200);
});

test('dashboard counts, search and filter', async () => {
  const s = (await call('GET', '/api/admin/summary')).data;
  assert.deepEqual([s.pending, s.accepted, s.declined, s.available_spaces], [2, 0, 0, 2]);
  const all = (await call('GET', '/api/admin/requests')).data.requests;
  assert.equal(all.length, 2);
  const found = (await call('GET', '/api/admin/requests?q=cruz')).data.requests;
  assert.deepEqual(found.map((r) => r.business_name), ['Cruz Tutorial Center']);
  assert.equal((await call('GET', '/api/admin/requests?q=%25')).data.requests.length, 0); // % is literal
  assert.equal((await call('GET', '/api/admin/requests?status=accepted')).data.requests.length, 0);
});

test('accepting a request records history and updates the space', async () => {
  const list = (await call('GET', '/api/admin/requests?q=Mabuhay')).data.requests;
  const id = list[0].id;
  const detail = (await call('GET', `/api/admin/requests/${id}`)).data;
  assert.equal(detail.request.status, 'pending');
  assert.equal(detail.events[0].action, 'Request submitted');

  assert.equal((await call('POST', `/api/admin/requests/${id}/decision`, { body: { decision: 'maybe' } })).status, 400);
  const ok = await call('POST', `/api/admin/requests/${id}/decision`, { body: { decision: 'accepted', note: 'Welcome aboard', space_status: 'reserved' } });
  assert.equal(ok.status, 200);
  const after = (await call('GET', `/api/admin/requests/${id}`)).data;
  assert.equal(after.request.status, 'accepted');
  assert.equal(after.request.decided_by_name, 'Test Admin');
  assert.deepEqual(after.events.map((e) => e.action), ['Request submitted', 'Accepted', 'Unit 1 set to reserved']);

  assert.equal((await call('POST', `/api/admin/requests/${id}/decision`, { body: { decision: 'declined' } })).status, 409);

  // Unit 1 is now reserved, so visitors can no longer request it.
  assert.equal((await call('POST', '/api/requests', {
    body: goodRequest(1),
    headers: { 'X-Forwarded-For': '10.0.0.10' },
    auth: false
  })).status, 422);
  const site = (await call('GET', '/api/site', { auth: false })).data;
  assert.equal(site.spaces[0].status, 'reserved');
});

test('declining works without touching the space', async () => {
  const id = (await call('GET', '/api/admin/requests?q=Cruz')).data.requests[0].id;
  assert.equal((await call('POST', `/api/admin/requests/${id}/decision`, { body: { decision: 'declined', note: 'Not a fit' } })).status, 200);
  const s = (await call('GET', '/api/admin/summary')).data;
  assert.deepEqual([s.pending, s.accepted, s.declined], [0, 1, 1]);
  assert.equal((await call('GET', '/api/site', { auth: false })).data.spaces[1].status, 'available');
});

test('spaces: add, edit, validate, status change, delete', async () => {
  assert.equal((await call('POST', '/api/admin/spaces', { body: { name: '' } })).status, 422);
  assert.equal((await call('POST', '/api/admin/spaces', { body: { name: 'X', size_sqm: -5 } })).status, 422);
  const created = await call('POST', '/api/admin/spaces', { body: { name: 'Unit 4', floor: 2, size_sqm: 30, monthly_rate: 12000, description: 'Corner unit' } });
  assert.equal(created.status, 201);
  const id = created.data.space.id;
  assert.equal(created.data.space.status, 'available');

  // Rates stay hidden until the admin turns them on.
  let pub = (await call('GET', '/api/site', { auth: false })).data.spaces.find((s) => s.id === id);
  assert.equal(pub.monthly_rate, null);
  assert.equal(pub.size_sqm, 30);

  assert.equal((await call('PUT', `/api/admin/spaces/${id}`, { body: { name: 'Unit 4A', floor: 2, size_sqm: 32, monthly_rate: 12000, status: 'available' } })).status, 200);
  assert.equal((await call('PATCH', `/api/admin/spaces/${id}/status`, { body: { status: 'bogus' } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/spaces/${id}/status`, { body: { status: 'occupied' } })).status, 200);
  assert.equal((await call('GET', `/api/admin/spaces/${id}`)).data.space.name, 'Unit 4A');

  assert.equal((await call('DELETE', `/api/admin/spaces/${id}`)).status, 200);
  assert.equal((await call('GET', `/api/admin/spaces/${id}`)).status, 404);
});

test('photos: upload, serve, reject non-images, delete', async () => {
  const png = fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'logo.png'));
  const fd = new FormData();
  fd.append('photos', new Blob([png], { type: 'image/png' }), 'unit.png');
  const up = await call('POST', '/api/admin/spaces/2/photos', { form: fd });
  assert.equal(up.status, 201);
  const pid = up.data.space.photos[0];

  const served = await fetch(`${base}/api/photos/${pid}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal((await call('GET', '/api/site', { auth: false })).data.spaces[1].photos[0], pid);

  const fake = new FormData();
  fake.append('photos', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'evil.png');
  assert.equal((await call('POST', '/api/admin/spaces/2/photos', { form: fake })).status, 400);

  const big = new FormData();
  big.append('photos', new Blob([Buffer.concat([png.subarray(0, 8), Buffer.alloc(6 * 1024 * 1024)])], { type: 'image/png' }), 'big.png');
  assert.equal((await call('POST', '/api/admin/spaces/2/photos', { form: big })).status, 413);

  assert.equal((await call('DELETE', `/api/admin/photos/${pid}`)).status, 200);
  assert.equal((await fetch(`${base}/api/photos/${pid}`)).status, 404);
});

test('settings: contact details appear on the public site', async () => {
  assert.equal((await call('PUT', '/api/admin/settings', { body: { address: 'A', contact_email: 'bad' } })).status, 422);
  assert.equal((await call('PUT', '/api/admin/settings', { body: { address: 'A', directions_url: 'javascript:alert(1)' } })).status, 422);
  const ok = await call('PUT', '/api/admin/settings', {
    body: { address: 'Don Rufino Alonzo Sr. St., Cotabato City', contact_phone: '0917 000 0000', contact_email: 'hello@example.com', office_hours: 'Mon-Sat 8-5', directions_url: 'https://maps.app.goo.gl/x', show_rates: true }
  });
  assert.equal(ok.status, 200);
  const pub = (await call('GET', '/api/site', { auth: false })).data;
  assert.equal(pub.settings.contact_phone, '0917 000 0000');
  assert.equal(pub.settings.directions_url, 'https://maps.app.goo.gl/x');
  // Turning rates on reveals them.
  await call('POST', '/api/admin/spaces', { body: { name: 'Priced', monthly_rate: 5000 } });
  const priced = (await call('GET', '/api/site', { auth: false })).data.spaces.find((s) => s.name === 'Priced');
  assert.equal(priced.monthly_rate, 5000);
});

test('bad ids and cross-site posts are handled safely', async () => {
  assert.equal((await call('GET', '/api/admin/requests/abc')).status, 404);
  assert.equal((await call('GET', '/api/admin/spaces/abc')).status, 404);
  assert.equal((await call('GET', '/api/photos/abc', { auth: false })).status, 404);
  const cross = await call('POST', '/api/requests', { body: goodRequest(2), auth: false, headers: { Origin: 'https://evil.example' } });
  assert.equal(cross.status, 403);
  const malformed = await fetch(base + '/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(malformed.status, 400);
});

test('login is rate limited after repeated failures', async () => {
  let last;
  for (let i = 0; i < 10; i++) {
    last = await call('POST', '/api/admin/login', { body: { email: 'victim@test.local', password: 'x' + i }, auth: false });
  }
  assert.equal(last.status, 429);
});

test('logout ends the session', async () => {
  assert.equal((await call('POST', '/api/admin/logout', { body: {} })).status, 200);
  assert.equal((await call('GET', '/api/admin/summary')).status, 401);
});

test('request form: target start date is optional but must be a real, non-past date', async () => {
  const none = await call('POST', '/api/requests', {
    body: goodRequest(1, { target_start_date: '' }),
    headers: { 'X-Forwarded-For': '10.0.0.11' },
    auth: false
  });
  assert.ok(!none.data.fields || !none.data.fields.target_start_date, 'empty date is accepted');
  for (const [index, bad] of ['2020-01-01', '2099-02-31', 'next week'].entries()) {
    const r = await call('POST', '/api/requests', {
      body: goodRequest(1, { target_start_date: bad }),
      headers: { 'X-Forwarded-For': `10.0.0.${12 + index}` },
      auth: false
    });
    assert.equal(r.status, 422, bad);
    assert.ok(r.data.fields.target_start_date, bad);
  }
});
