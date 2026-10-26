'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  // Hosting platforms put a proxy in front of the app; trust one hop so
  // req.ip and req.secure are correct.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"]
        }
      }
    })
  );

  app.use(express.json({ limit: '50kb' }));

  // Reject state-changing API calls that come from another website.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === req.get('host'); } catch { ok = false; }
      if (!ok) return res.status(403).json({ error: 'Cross-site request blocked.' });
    }
    next();
  });

  app.use('/api/admin', adminRoutes(db));
  app.use('/api', publicRoutes(db));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: '5m' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || 500;
    let message = err.expose === false ? 'Something went wrong.' : err.message;
    if (err.type === 'entity.parse.failed') { status = 400; message = 'Invalid request body.'; }
    if (err.type === 'entity.too.large') { status = 413; message = 'Request is too large.'; }
    if (err.code === 'LIMIT_FILE_SIZE') { status = 413; message = 'Each photo must be 5 MB or smaller.'; }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') { status = 400; message = 'You can upload up to 8 photos at a time.'; }
    if (status >= 500) {
      console.error(err);
      message = 'Something went wrong. Please try again.';
    }
    if (req.path.startsWith('/api')) return res.status(status).json({ error: message, ...(err.fields ? { fields: err.fields } : {}) });
    res.status(status).type('text').send(message);
  });

  return app;
}

module.exports = { createApp };
