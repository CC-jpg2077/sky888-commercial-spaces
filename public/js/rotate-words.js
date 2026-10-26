/* Rotating word in the intro headline ("A space for your shop / café / clinic ...").
   Each word slides in from below and the previous one slides up and out.
   The look is handled in CSS; this only moves the "is-current" marker along.
   With reduced motion (or no JS) the first word simply stays put. */
(function () {
  'use strict';

  var words = Array.prototype.slice.call(document.querySelectorAll('.rotator__word'));
  if (words.length < 2) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var index = 0;
  setInterval(function () {
    index = (index + 1) % words.length;
    words.forEach(function (w, i) {
      w.classList.toggle('is-current', i === index);
      w.classList.toggle('is-past', i < index);
      w.setAttribute('aria-hidden', i === index ? 'false' : 'true');
    });
  }, 2000);
})();
