'use strict';

// Express 4 does not catch errors thrown inside async handlers. This wrapper
// forwards them to the app's error handler.
const ah = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Turn a URL parameter into a valid database id, or null if it is not one.
function toId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 2147483647 ? n : null;
}

module.exports = { ah, toId };
