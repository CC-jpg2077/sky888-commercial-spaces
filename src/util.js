'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Strip control characters but keep tab and newline for multi-line fields.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function field(raw, label, { required = false, max = 200, min = 0 } = {}) {
  const v = typeof raw === 'string' ? raw.replace(CONTROL_RE, '').trim() : '';
  if (required && !v) return { v, err: `${label} is required.` };
  if (v && v.length < min) return { v, err: `${label} must be at least ${min} characters.` };
  if (v.length > max) return { v, err: `${label} must be ${max} characters or fewer.` };
  return { v };
}

function isEmail(v) {
  return v.length <= 254 && EMAIL_RE.test(v);
}

function normalizePhone(v) {
  if (typeof v !== 'string' || !/^[0-9+()\-.\s]+$/.test(v)) return null;
  const digits = v.replace(/\D/g, '');
  if (!/^09\d{9}$/.test(digits)) return null;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
}

function isPhone(v) {
  return normalizePhone(v) !== null;
}

// Optional positive number; empty string or null means "not set".
function optionalNumber(raw, label, { max = 1e9 } = {}) {
  if (raw === null || raw === undefined || raw === '') return { v: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > max) return { v: null, err: `${label} must be a positive number.` };
  return { v: n };
}

function optionalInt(raw, label, { min = 0, max = 200 } = {}) {
  if (raw === null || raw === undefined || raw === '') return { v: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return { v: null, err: `${label} must be a whole number.` };
  return { v: n };
}

// In-memory attempt counter. Good enough for a single small server.
function createLimiter({ max, windowMs }) {
  const hits = new Map();

  function prune(now) {
    for (const [k, e] of hits) if (e.reset <= now) hits.delete(k);
  }
  function entry(key, now) {
    let e = hits.get(key);
    if (!e || e.reset <= now) {
      e = { count: 0, reset: now + windowMs };
      hits.set(key, e);
    }
    return e;
  }

  return {
    // Is this key still allowed? Does not count an attempt.
    check(key) {
      const now = Date.now();
      const e = hits.get(key);
      if (!e || e.reset <= now) return { ok: true, retryAfter: 0 };
      return { ok: e.count < max, retryAfter: Math.ceil((e.reset - now) / 1000) };
    },
    // Count one attempt.
    hit(key) {
      const now = Date.now();
      if (hits.size > 5000) prune(now);
      const e = entry(key, now);
      e.count += 1;
      return { ok: e.count <= max, retryAfter: Math.ceil((e.reset - now) / 1000) };
    },
    reset(key) {
      hits.delete(key);
    }
  };
}

function httpError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  if (extra) Object.assign(e, extra);
  return e;
}

module.exports = { field, isEmail, normalizePhone, isPhone, optionalNumber, optionalInt, createLimiter, httpError };
