(function () {
  'use strict';

  var STATUS_LABEL = { reserved: 'Currently reserved', occupied: 'Currently occupied' };
  var ARROW = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
  var INFO = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';

  var $ = function (id) { return document.getElementById(id); };
  var form = $('request-form');
  var select = $('space_id');
  var FIELDS = ['contact_name', 'business_name', 'business_type', 'phone', 'email', 'target_start_date', 'space_id'];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function money(n) {
    return '₱' + Number(n).toLocaleString('en-PH', { maximumFractionDigits: 0 });
  }

  function metaLine(s) {
    var parts = [];
    if (s.floor !== null && s.floor !== undefined) parts.push(s.floor === 0 ? 'Ground floor' : 'Floor ' + s.floor);
    if (s.size_sqm) parts.push(s.size_sqm + ' sqm');
    if (s.monthly_rate) parts.push(money(s.monthly_rate) + ' / month');
    return parts.join(' · ');
  }

  function renderSpaces(spaces) {
    var box = $('cards');
    box.replaceChildren();
    if (!spaces.length) {
      box.appendChild(el('p', 'muted', 'No spaces are listed yet. Please check back soon.'));
      return;
    }
    spaces.forEach(function (s) {
      var open = s.status === 'available';
      var card = el(open ? 'a' : 'div', 'card' + (open ? '' : ' card--closed'));
      if (open) {
        card.href = '#request';
        card.dataset.spaceId = String(s.id);
      }
      var img = el('img', 'card__img');
      img.src = s.photos.length ? '/api/photos/' + s.photos[0] : '/img/building.png';
      img.alt = s.name + ' at SKY888';
      img.loading = 'lazy';
      card.appendChild(img);

      var body = el('div', 'card__body');
      var top = el('div', 'card__name', s.name);
      body.appendChild(top);
      var meta = metaLine(s);
      if (meta) body.appendChild(el('p', 'card__meta', meta));

      var row = el('div', 'card__row');
      if (open) {
        row.appendChild(el('span', 'card__cta', 'Request this space'));
        var arrow = el('span');
        arrow.innerHTML = ARROW; // constant markup, no user data
        row.appendChild(arrow);
        row.style.marginTop = '6px';
      } else {
        row.appendChild(el('span', 'card__status', STATUS_LABEL[s.status] || 'Not available'));
        var info = el('span');
        info.innerHTML = INFO;
        row.appendChild(info);
        row.style.marginTop = '6px';
      }
      body.appendChild(row);
      card.appendChild(body);
      box.appendChild(card);
    });
  }

  function renderSelect(spaces, keepValue) {
    var open = spaces.filter(function (s) { return s.status === 'available'; });
    select.replaceChildren();
    var first = el('option', '', open.length ? 'Select a space' : 'No spaces are open right now');
    first.value = '';
    select.appendChild(first);
    open.forEach(function (s) {
      var o = el('option', '', s.name);
      o.value = String(s.id);
      select.appendChild(o);
    });
    if (keepValue && open.some(function (s) { return String(s.id) === keepValue; })) select.value = keepValue;
  }

  function renderSettings(st) {
    $('address').textContent = st.address;
    var dir = $('directions');
    dir.href = st.directions_url || ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(st.address));

    var lines = $('contact-lines');
    lines.replaceChildren();
    function line(label, value, href) {
      if (lines.childNodes.length) lines.appendChild(document.createElement('br'));
      lines.appendChild(document.createTextNode(label + ': '));
      if (value && href) {
        var a = el('a', '', value);
        a.href = href;
        lines.appendChild(a);
      } else {
        lines.appendChild(document.createTextNode(value || 'to be announced'));
      }
    }
    line('Phone', st.contact_phone);
    line('Email', st.contact_email);
    if (st.office_hours) {
      lines.appendChild(document.createElement('br'));
      lines.appendChild(document.createTextNode(st.office_hours));
    }
  }

  function loadSite(keepValue) {
    return fetch('/api/site', { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('load failed'); return r.json(); })
      .then(function (data) {
        renderSpaces(data.spaces);
        renderSelect(data.spaces, keepValue);
        renderSettings(data.settings);
      })
      .catch(function () {
        $('cards').replaceChildren(el('p', 'muted', 'We could not load the spaces right now. Please refresh the page.'));
      });
  }

  // Choosing a card pre-selects it in the form.
  $('cards').addEventListener('click', function (e) {
    var card = e.target.closest('a.card');
    if (!card) return;
    select.value = card.dataset.spaceId;
    clearError('space_id');
  });

  // ---- form ---------------------------------------------------------------

  function setError(name, msg) {
    var p = $('err-' + name);
    if (!p) return;
    p.textContent = msg || '';
    var wrap = p.closest('.field');
    if (wrap) wrap.classList.toggle('has-error', !!msg);
    var input = $(name);
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function clearError(name) { setError(name, ''); }

  // Today as YYYY-MM-DD in the visitor's own time zone.
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function validate(v) {
    var e = {};
    if (!v.contact_name) e.contact_name = 'Enter your full name.';
    if (!v.business_name) e.business_name = 'Enter your business name.';
    if (!v.business_type) e.business_type = 'Enter your type of business.';
    if (v.target_start_date && v.target_start_date < today()) e.target_start_date = 'Choose today or a later date.';
    if (!v.space_id) e.space_id = 'Choose a space.';
    var digits = v.phone.replace(/\D/g, '');
    if (!v.phone) e.phone = 'Enter a phone number.';
    else if (!/^[0-9+()\-.\s]+$/.test(v.phone) || digits.length < 7 || digits.length > 15) e.phone = 'Enter a valid phone number.';
    if (!v.email) e.email = 'Enter an email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) e.email = 'Enter a valid email address.';
    return e;
  }

  function values() {
    var out = {};
    ['contact_name', 'business_name', 'business_type', 'phone', 'email', 'target_start_date', 'space_id', 'notes', 'website'].forEach(function (k) {
      out[k] = (form.elements[k].value || '').trim();
    });
    return out;
  }

  function showErrors(errs) {
    var firstBad = null;
    FIELDS.forEach(function (k) {
      setError(k, errs[k] || '');
      if (errs[k] && !firstBad) firstBad = k;
    });
    if (firstBad) $(firstBad).focus();
  }

  FIELDS.forEach(function (k) {
    $(k).addEventListener('input', function () { clearError(k); });
    $(k).addEventListener('change', function () { clearError(k); });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var formError = $('form-error');
    formError.textContent = '';
    var v = values();
    var errs = validate(v);
    if (Object.keys(errs).length) {
      showErrors(errs);
      formError.textContent = 'Please fix the highlighted fields.';
      return;
    }
    var btn = $('submit-btn');
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Sending…';

    fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(Object.assign({}, v, { space_id: Number(v.space_id) }))
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, status: r.status, body: b }; }); })
      .then(function (res) {
        if (res.ok) {
          $('ref').textContent = res.body.reference_no;
          form.hidden = true;
          var done = $('done');
          done.hidden = false;
          done.focus();
          return;
        }
        if (res.body.fields) showErrors(res.body.fields);
        formError.textContent = res.body.error || 'We could not send your request. Please try again.';
        if (res.body.fields && res.body.fields.space_id) loadSite('');
      })
      .catch(function () {
        formError.textContent = 'We could not reach the server. Check your connection and try again.';
      })
      .then(function () {
        btn.disabled = false;
        btn.querySelector('span').textContent = 'Submit request';
      });
  });

  $('another').addEventListener('click', function () {
    form.reset();
    FIELDS.forEach(clearError);
    $('form-error').textContent = '';
    $('done').hidden = true;
    form.hidden = false;
    loadSite('');
    $('business_name').focus();
  });

  $('target_start_date').min = today();
  $('year').textContent = String(new Date().getFullYear());
  loadSite('');
})();
