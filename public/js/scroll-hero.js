/* Scroll-expansion hero.
   The building photo starts small. Scrolling (wheel, touch or keys) grows it
   to fill the screen, the title splits apart, and only then does the page
   scroll normally. Scrolling back to the very top closes it again.
   Plain JS + CSS: the hero is driven by one CSS variable, --p (0 to 1).
   Nothing runs for visitors who prefer reduced motion; they get a static hero. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return; // no 'js' class, so the CSS keeps the simple static layout

  root.classList.add('js'); // set before first paint (script is in <head>)

  document.addEventListener('DOMContentLoaded', function () {
    var hero = document.getElementById('hero');
    var after = document.getElementById('after');
    var topbar = document.querySelector('.topbar');
    if (!hero || !after) { root.classList.remove('js'); return; }

    var progress = 0;       // 0 = small photo, 1 = fully open
    var expanded = false;   // page is free to scroll
    var showContent = false;
    var touchY = 0;
    var frame = 0;

    function paint() {
      frame = 0;
      hero.style.setProperty('--p', progress.toFixed(4));
      after.classList.toggle('is-visible', showContent);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
    function clamp(n) { return Math.min(Math.max(n, 0), 1); }

    function setProgress(next) {
      progress = clamp(next);
      if (progress >= 1) { expanded = true; showContent = true; }
      else if (progress < 0.75) { showContent = false; }
      schedule();
    }
    function openNow() {
      progress = 1; expanded = true; showContent = true;
      schedule();
    }

    function sizeHero() {
      if (topbar) hero.style.setProperty('--topbar', topbar.offsetHeight + 'px');
    }
    sizeHero();
    window.addEventListener('resize', sizeHero);
    paint();

    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey) return; // pinch-zoom
      if (expanded && e.deltaY < 0 && window.scrollY <= 5) {
        expanded = false;
        e.preventDefault();
      } else if (!expanded) {
        e.preventDefault();
        setProgress(progress + e.deltaY * 0.0009);
      }
    }, { passive: false });

    window.addEventListener('touchstart', function (e) {
      touchY = e.touches[0].clientY;
    }, { passive: true });

    window.addEventListener('touchmove', function (e) {
      if (!touchY) return;
      var y = e.touches[0].clientY;
      var dy = touchY - y;
      if (expanded && dy < -20 && window.scrollY <= 5) {
        expanded = false;
        e.preventDefault();
      } else if (!expanded) {
        e.preventDefault();
        setProgress(progress + dy * (dy < 0 ? 0.008 : 0.005));
        touchY = y;
      }
    }, { passive: false });

    window.addEventListener('touchend', function () { touchY = 0; });

    window.addEventListener('scroll', function () {
      if (!expanded && window.scrollY !== 0) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    });

    // Keyboard: arrows, Page Up/Down, Space, Home/End work the same way.
    window.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      var t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      var k = e.key;
      var down = k === 'ArrowDown' || k === 'PageDown' || k === 'End' || (k === ' ' && !e.shiftKey && t === document.body);
      var up = k === 'ArrowUp' || k === 'PageUp' || k === 'Home' || (k === ' ' && e.shiftKey && t === document.body);
      if (!down && !up) return;
      if (!expanded) {
        e.preventDefault();
        var big = k === 'PageDown' || k === 'PageUp' || k === ' ';
        if (k === 'End') openNow();
        else if (k === 'Home') setProgress(0);
        else setProgress(progress + (down ? 1 : -1) * (big ? 0.3 : 0.1));
      } else if (up && window.scrollY <= 5) {
        expanded = false;
        e.preventDefault();
      }
    });

    // Links to a section open the hero first, so the target is never hidden.
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (a && a.getAttribute('href') !== '#top' && !expanded) openNow();
    });
    window.addEventListener('hashchange', function () {
      if (location.hash && location.hash !== '#top') openNow();
    });
    if (location.hash && location.hash !== '#top') openNow();
  });
})();
