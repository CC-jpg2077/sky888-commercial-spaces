'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('static site data is valid', () => {
  const site = JSON.parse(fs.readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  assert.equal(site.address, 'Don Rufino Alonzo Sr. St., Brgy. Poblacion 5, Cotabato City 9600');
  assert.equal(site.directionsUrl, '');
  assert.equal(site.contactPhone, '');
  assert.equal(site.contactEmail, '');
  assert.equal(site.officeHours, '');
  assert.equal(site.facebookUrl, '');
});

test('seed unit data is valid and uniquely identified', () => {
  const units = JSON.parse(fs.readFileSync(path.join(root, 'data', 'units.json'), 'utf8'));
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
