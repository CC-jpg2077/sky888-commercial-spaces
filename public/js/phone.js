(function () {
  'use strict';

  function digits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function format(value) {
    var v = digits(value);
    if (v.length > 11) return v;
    if (v.length > 7) return v.slice(0, 4) + ' ' + v.slice(4, 7) + ' ' + v.slice(7);
    if (v.length > 4) return v.slice(0, 4) + ' ' + v.slice(4);
    return v;
  }

  function normalize(value) {
    var v = String(value || '');
    if (!/^[0-9+().\-\s]+$/.test(v)) return null;
    var d = digits(v);
    return /^09\d{9}$/.test(d) ? format(d) : null;
  }

  function bind(input) {
    function update() { input.value = format(input.value); }
    input.addEventListener('input', update);
    input.addEventListener('blur', update);
    update();
  }

  window.SkyPhone = { format: format, normalize: normalize, isValid: function (value) { return normalize(value) !== null; }, bind: bind };
}());
