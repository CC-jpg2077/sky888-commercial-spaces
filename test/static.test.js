'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('static site data is valid', () => {
  const site = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', 'site.json'), 'utf8'));
  assert.equal(site.address, 'Don Rufino Alonzo Sr. St., Brgy. Poblacion 5, Cotabato City 9600');
  assert.equal(site.directionsUrl, '');
  assert.equal(site.contactPhone, '');
  assert.equal(site.contactEmail, '');
  assert.equal(site.officeHours, '');
  assert.match(site.facebookUrl, /^https:\/\/(www\.)?facebook\.com\//);
});

test('seed unit data is valid and uniquely identified', () => {
  const units = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', 'units.json'), 'utf8'));
  assert.deepEqual(
    units.map(({ name, status }) => [name, status]),
    [['Unit 1', 'available'], ['Unit 2', 'available'], ['Unit 3', 'reserved']]
  );
  assert.equal(new Set(units.map((unit) => unit.id)).size, units.length);
  for (const unit of units) {
    assert.ok(['available', 'reserved', 'occupied'].includes(unit.status));
    assert.ok(Array.isArray(unit.photos));
  }
});

test('package has no backend runtime', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test test/static.test.js');
  assert.equal(pkg.scripts.start, undefined);
  assert.equal(pkg.dependencies, undefined);
});

test('homepage is a static Facebook callout with no backend UI', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<form\b|\/api\/|\/admin\/|reference number|Submit request/i);
  assert.match(html, /id="facebook-card"/);
  assert.match(html, /id="facebook-link"/);
});

test('Vercel serves repository-root static assets', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(vercel.outputDirectory, 'public');
});

test('static site helpers handle cards and Facebook placeholders', () => {
  const context = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'public', 'js', 'site.js'), 'utf8'),
    context
  );
  const helpers = context.window.Sky888Site;
  assert.equal(helpers.photoFor({ photos: [] }), '/img/building.png');
  assert.equal(helpers.photoFor({ photos: ['/img/unit.png'] }), '/img/unit.png');
  assert.equal(helpers.isAvailable({ status: 'available' }), true);
  assert.equal(helpers.isAvailable({ status: 'reserved' }), false);
  assert.equal(helpers.facebookConfigured(''), false);
  assert.equal(helpers.facebookConfigured('LINK_TO_BE_ADDED'), false);
  assert.equal(helpers.facebookConfigured('https://facebook.com/sky888'), true);
  var image = {
    src: '/img/missing.png',
    onerror: function () {}
  };
  helpers.fallbackImageHandler(image)();
  assert.equal(image.src, '/img/building.png');
  assert.equal(image.onerror, null);
});

test('backend and admin surfaces are removed', () => {
  for (const stalePath of [
    'server.js',
    'src',
    'test/app.test.js',
    'scripts',
    'package-lock.json'
  ]) {
    assert.equal(fs.existsSync(path.join(root, stalePath)), false, stalePath);
  }
});

test('homepage preserves main sections and responsive unit grid', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  for (const id of ['hero', 'about', 'spaces', 'location', 'request']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const css = fs.readFileSync(path.join(root, 'public', 'css', 'site.css'), 'utf8');
  assert.match(css, /\.cards\s*\{[^}]*grid-template-columns:\s*repeat\(3,/);
  assert.match(css, /@media/);
});
