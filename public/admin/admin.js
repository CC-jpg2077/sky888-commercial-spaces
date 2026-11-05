(function () {
  'use strict';

  var app = document.getElementById('app');
  var toastEl = document.getElementById('toast');
  var state = { admin: null, token: 0 };

  // ---- small helpers --------------------------------------------------------

  // Builds DOM nodes. Strings are always inserted as text, never as HTML.
  function h(tag, attrs) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else if (k === 'checked') n.checked = !!v;
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function add(parent, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(parent, x); });
    else parent.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
  }
  function fmtDay(ymd) {
    var d = new Date(ymd + 'T00:00:00Z');
    if (isNaN(d)) return ymd;
    return d.toLocaleDateString('en-PH', { timeZone: 'UTC', dateStyle: 'long' });
  }
  function money(n) { return '₱' + Number(n).toLocaleString('en-PH', { maximumFractionDigits: 0 }); }
  function badge(status) { return h('span', { class: 'badge badge--' + status }, cap(status)); }
  function spaceMeta(s) {
    var p = [];
    if (s.floor !== null && s.floor !== undefined) p.push(s.floor === 0 ? 'Ground floor' : 'Floor ' + s.floor);
    if (s.size_sqm) p.push(s.size_sqm + ' sqm');
    if (s.monthly_rate) p.push(money(s.monthly_rate) + ' / month');
    return p.join(' · ');
  }

  var toastTimer;
  function toast(msg, bad) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 3500);
  }

  function api(method, path, body, isForm) {
    var opt = { method: method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      if (isForm) opt.body = body;
      else { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    }
    return fetch('/api/admin' + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.ok) return data;
        var err = new Error(data.error || 'Something went wrong.');
        err.status = r.status;
        err.code = data.code;
        if (r.status === 401 && data.code === 'login_required' && state.admin) {
          state.admin = null;
          showLogin('Your session ended. Please log in again.');
        } else if (r.status === 403 && data.code === 'must_change_password') {
          if (state.admin) state.admin.must_change_password = true;
          route();
        }
        throw err;
      });
    });
  }

  function field(label, input, hint, id) {
    return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { class: 'hint' }, hint) : null);
  }

  // ---- screens ---------------------------------------------------------------

  function showLogin(message) {
    app.replaceChildren();
    var err = h('p', { class: 'error', role: 'alert' }, message || '');
    var email = h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true });
    var pw = h('input', { id: 'pw', type: 'password', autocomplete: 'current-password', required: true });
    var btn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Log in');
    var form = h('form', {
      novalidate: true,
      onsubmit: function (e) {
        e.preventDefault();
        err.textContent = '';
        if (!email.value.trim() || !pw.value) { err.textContent = 'Enter your email and password.'; return; }
        btn.disabled = true;
        api('POST', '/login', { email: email.value, password: pw.value })
          .then(function (d) { state.admin = d.admin; location.hash = '#/'; route(); })
          .catch(function (x) { err.textContent = x.message; pw.value = ''; pw.focus(); })
          .then(function () { btn.disabled = false; });
      }
    }, err, field('Email', email, null, 'email'), field('Password', pw, null, 'pw'), btn);
    app.appendChild(h('div', { class: 'login' },
      h('div', { class: 'login__card' },
        h('div', { class: 'login__brand' }, h('img', { src: '/img/logo.png', alt: '' }),
          h('div', null, h('b', null, 'SKY888'), h('span', { class: 'muted small' }, 'Admin'))),
        h('h1', null, 'Admin login'),
        h('p', { class: 'muted' }, 'For authorized staff only.'),
        form,
        h('p', { class: 'small', style: 'margin-top:18px' }, h('a', { href: '/' }, 'Back to the public site')))));
    email.focus();
  }

  function shell(active) {
    var main = h('main', { class: 'main', id: 'main' });
    var forced = state.admin.must_change_password;
    var tabs = forced ? null : h('nav', { class: 'tabs', 'aria-label': 'Admin' },
      [['#/', 'Dashboard', 'dash'], ['#/spaces', 'Spaces', 'spaces'], ['#/settings', 'Site details', 'settings'], ['#/password', 'Password', 'password']]
        .map(function (t) { return h('a', { href: t[0], 'aria-current': active === t[2] ? 'page' : null }, t[1]); }));
    var top = h('header', { class: 'topbar' }, h('div', { class: 'topbar__inner' },
      h('a', { class: 'brand', href: '#/' }, h('img', { src: '/img/logo.png', alt: '' }), h('div', null, h('b', null, 'SKY888'), h('span', null, 'Admin'))),
      tabs || h('div', { class: 'tabs' }),
      h('div', { class: 'who' },
        h('span', null, state.admin.name),
        h('a', { class: 'small', href: '/', style: 'color:#d8dde6' }, 'View site'),
        h('button', {
          class: 'btn btn--ghost', type: 'button', onclick: function () {
            api('POST', '/logout', {}).catch(function () {}).then(function () { state.admin = null; location.hash = '#/'; showLogin(); });
          }
        }, 'Log out'))));
    app.replaceChildren(top, main);
    return main;
  }

  function pageHead(title, extra) {
    return h('div', { class: 'page-head' }, h('h1', null, title), extra || null);
  }

  // Dashboard: counts, then searchable request list.
  function viewDashboard(main, tok) {
    main.appendChild(pageHead('Dashboard'));
    var stats = h('div', { class: 'grid grid--4' });
    main.appendChild(stats);
    var search = h('input', { id: 'q', type: 'search', placeholder: 'Reference, business, contact, space…', autocomplete: 'off' });
    var status = h('select', { id: 'st' },
      [['', 'All statuses'], ['pending', 'Pending'], ['accepted', 'Accepted'], ['declined', 'Declined']]
        .map(function (o) { return h('option', { value: o[0] }, o[1]); }));
    var holder = h('div', { class: 'table-wrap' });
    main.appendChild(h('section', { class: 'card' },
      h('h2', null, 'Requests'),
      h('div', { class: 'toolbar' },
        h('div', null, h('label', { for: 'q' }, 'Search'), search),
        h('div', null, h('label', { for: 'st' }, 'Status'), status)),
      holder));

    function loadStats() {
      return api('GET', '/summary').then(function (s) {
        if (tok !== state.token) return;
        stats.replaceChildren.apply(stats,
          [['Pending', s.pending], ['Accepted', s.accepted], ['Declined', s.declined], ['Available spaces', s.available_spaces]]
            .map(function (x) { return h('div', { class: 'stat' }, h('span', null, x[0]), h('b', null, String(x[1]))); }));
      });
    }
    function loadList() {
      var qs = '?status=' + encodeURIComponent(status.value) + '&q=' + encodeURIComponent(search.value.trim());
      return api('GET', '/requests' + qs).then(function (d) {
        if (tok !== state.token) return;
        if (!d.requests.length) {
          holder.replaceChildren(h('p', { class: 'empty' }, search.value || status.value ? 'No requests match your search.' : 'No requests yet. They will appear here when someone submits the form.'));
          return;
        }
        holder.replaceChildren(h('table', null,
          h('thead', null, h('tr', null, ['Reference', 'Business', 'Contact', 'Space', 'Submitted', 'Status', ''].map(function (t) { return h('th', { scope: 'col' }, t); }))),
          h('tbody', null, d.requests.map(function (r) {
            return h('tr', null,
              h('td', null, h('a', { href: '#/requests/' + r.id }, r.reference_no)),
              h('td', null, r.business_name, r.business_type ? h('div', { class: 'small muted' }, r.business_type) : null), h('td', null, r.contact_name), h('td', null, r.space_name),
              h('td', null, fmtDate(r.submitted_at)), h('td', null, badge(r.status)),
              h('td', null, h('a', { class: 'btn btn--sm', href: '#/requests/' + r.id }, r.status === 'pending' ? 'Review' : 'View')));
          }))));
      });
    }
    var timer;
    search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(loadList, 250); });
    status.addEventListener('change', loadList);
    return Promise.all([loadStats(), loadList()]);
  }

  function viewRequest(main, tok, id) {
    return api('GET', '/requests/' + id).then(function (d) {
      if (tok !== state.token) return;
      var r = d.request;
      main.appendChild(h('a', { class: 'back', href: '#/' }, '← Back to requests'));
      main.appendChild(pageHead('Request ' + r.reference_no, badge(r.status)));
      main.appendChild(h('p', { class: 'muted', style: 'margin:-12px 0 24px' }, 'Submitted ' + fmtDate(r.submitted_at)));

      var left = h('div', null,
        h('section', { class: 'card' }, h('h2', null, 'Business'),
          h('dl', { class: 'kv' },
            h('div', null, h('dt', null, 'Business name'), h('dd', null, r.business_name)),
            h('div', null, h('dt', null, 'Business type'), h('dd', null, r.business_type || '—')),
            h('div', null, h('dt', null, 'Preferred space'), h('dd', null, r.space_name)),
            h('div', null, h('dt', null, 'Target start date'), h('dd', null, r.target_start_date ? fmtDay(r.target_start_date) : 'Not given'))),
          r.business_description ? h('div', { style: 'margin-top:16px' }, h('p', { class: 'small muted' }, 'DESCRIPTION'), h('p', { class: 'pre' }, r.business_description)) : null,
          r.notes ? h('div', { style: 'margin-top:16px' }, h('p', { class: 'small muted' }, 'MESSAGE'), h('p', { class: 'pre' }, r.notes)) : null),
        h('section', { class: 'card' }, h('h2', null, 'Contact'),
          h('dl', { class: 'kv' },
            h('div', null, h('dt', null, 'Contact person'), h('dd', null, r.contact_name)),
            h('div', null, h('dt', null, 'Phone'), h('dd', null, h('a', { href: 'tel:' + r.phone.replace(/[^0-9+]/g, '') }, r.phone))),
            h('div', null, h('dt', null, 'Email'), h('dd', null, h('a', { href: 'mailto:' + r.email }, r.email))))),
        h('section', { class: 'card' }, h('h2', null, 'History'),
          h('ol', { class: 'timeline' }, d.events.map(function (e) {
            return h('li', null,
              h('span', null, h('b', { style: 'font-weight:500' }, e.action), e.admin_name ? ' by ' + e.admin_name : '', e.note ? ' — ' + e.note : ''),
              h('span', { class: 't' }, fmtDate(e.at)));
          }))));

      var spaceCard = h('section', { class: 'card' }, h('h2', null, 'Requested space'),
        h('p', null, r.space_name), r.space_status ? h('p', { style: 'margin-top:8px' }, badge(r.space_status)) : h('p', { class: 'muted small' }, 'This space has since been removed.'));

      var right = h('div', null, spaceCard);
      if (r.status === 'pending') {
        var note = h('textarea', { id: 'note', maxlength: '500', placeholder: 'Shown only to admins' });
        var sp = h('select', { id: 'sp' },
          [['', 'Leave the space as it is'], ['reserved', 'Mark as reserved'], ['occupied', 'Mark as occupied'], ['available', 'Mark as available']]
            .map(function (o) { return h('option', { value: o[0] }, o[1]); }));
        var err = h('p', { class: 'error', role: 'alert' });
        var decide = function (decision) {
          if (!window.confirm(decision === 'accepted' ? 'Accept this request?' : 'Decline this request?')) return;
          err.textContent = '';
          api('POST', '/requests/' + r.id + '/decision', { decision: decision, note: note.value, space_status: r.space_id ? sp.value : '' })
            .then(function () { toast('Request ' + decision + '.'); route(); })
            .catch(function (x) { err.textContent = x.message; });
        };
        right.appendChild(h('section', { class: 'card' }, h('h2', null, 'Decision'), err,
          field('Note (optional)', note, null, 'note'),
          r.space_id ? field('Space status', sp, 'When accepting, you can mark the space reserved or occupied.', 'sp') : null,
          h('div', { class: 'actions' },
            h('button', { class: 'btn btn--primary', type: 'button', onclick: function () { decide('accepted'); } }, 'Accept'),
            h('button', { class: 'btn btn--danger', type: 'button', onclick: function () { decide('declined'); } }, 'Decline'))));
      } else {
        right.appendChild(h('section', { class: 'card' }, h('h2', null, 'Decision'),
          h('p', null, cap(r.status) + (r.decided_by_name ? ' by ' + r.decided_by_name : '') + ' on ' + fmtDate(r.decided_at) + '.'),
          r.decision_note ? h('p', { class: 'pre', style: 'margin-top:10px' }, r.decision_note) : null));
      }
      main.appendChild(h('div', { class: 'grid grid--2' }, left, right));
    });
  }

  function viewSpaces(main, tok) {
    main.appendChild(pageHead('Spaces', h('a', { class: 'btn btn--primary', href: '#/spaces/new' }, 'Add space')));
    var box = h('section', { class: 'card' });
    main.appendChild(box);
    return api('GET', '/spaces').then(function (d) {
      if (tok !== state.token) return;
      if (!d.spaces.length) { box.appendChild(h('p', { class: 'empty' }, 'No spaces yet. Add the first one.')); return; }
      d.spaces.forEach(function (s) {
        var sel = h('select', {
          'aria-label': 'Status of ' + s.name,
          onchange: function () {
            api('PATCH', '/spaces/' + s.id + '/status', { status: sel.value })
              .then(function () { toast(s.name + ' is now ' + sel.value + '.'); })
              .catch(function (x) { toast(x.message, true); route(); });
          }
        }, ['available', 'reserved', 'occupied'].map(function (v) { return h('option', { value: v, selected: v === s.status }, cap(v)); }));
        box.appendChild(h('div', { class: 'space-row' },
          h('img', { src: s.photos.length ? '/api/photos/' + s.photos[0] : '/img/building.png', alt: '' }),
          h('div', null, h('b', { style: 'font-weight:500' }, s.name),
            h('p', { class: 'small muted' }, spaceMeta(s) || 'No size or rate added yet'),
            s.pending_requests ? h('p', { class: 'small' }, s.pending_requests + ' pending request' + (s.pending_requests > 1 ? 's' : '')) : null),
          sel,
          h('a', { class: 'btn btn--sm', href: '#/spaces/' + s.id }, 'Edit')));
      });
    });
  }

  function viewSpaceForm(main, tok, id) {
    var isNew = id === 'new';
    var load = isNew ? Promise.resolve({ space: { name: '', floor: null, size_sqm: null, monthly_rate: null, description: '', status: 'available', photos: [] } }) : api('GET', '/spaces/' + id);
    return load.then(function (d) {
      if (tok !== state.token) return;
      var s = d.space;
      main.appendChild(h('a', { class: 'back', href: '#/spaces' }, '← Back to spaces'));
      main.appendChild(pageHead(isNew ? 'Add space' : 'Edit ' + s.name));
      var err = h('p', { class: 'error', role: 'alert' });
      var name = h('input', { id: 'n', type: 'text', maxlength: '80', value: s.name, required: true });
      var floor = h('input', { id: 'f', type: 'number', min: '0', max: '50', step: '1', value: s.floor === null ? '' : s.floor });
      var size = h('input', { id: 'z', type: 'number', min: '0', step: 'any', value: s.size_sqm === null ? '' : s.size_sqm });
      var rate = h('input', { id: 'r', type: 'number', min: '0', step: 'any', value: s.monthly_rate === null ? '' : s.monthly_rate });
      var status = h('select', { id: 's' }, ['available', 'reserved', 'occupied'].map(function (v) { return h('option', { value: v, selected: v === s.status }, cap(v)); }));
      var desc = h('textarea', { id: 'd', maxlength: '1000', value: s.description });
      var save = h('button', { class: 'btn btn--primary', type: 'submit' }, isNew ? 'Add space' : 'Save changes');

      var form = h('form', {
        novalidate: true,
        onsubmit: function (e) {
          e.preventDefault();
          err.textContent = '';
          if (!name.value.trim()) { err.textContent = 'Name is required.'; name.focus(); return; }
          save.disabled = true;
          var body = { name: name.value, floor: floor.value, size_sqm: size.value, monthly_rate: rate.value, status: status.value, description: desc.value };
          api(isNew ? 'POST' : 'PUT', isNew ? '/spaces' : '/spaces/' + id, body)
            .then(function (res) {
              toast(isNew ? 'Space added. You can now add photos.' : 'Changes saved.');
              if (isNew) location.hash = '#/spaces/' + res.space.id; else route();
            })
            .catch(function (x) { err.textContent = x.message; })
            .then(function () { save.disabled = false; });
        }
      }, err,
        field('Name', name, 'For example: Unit 1', 'n'),
        h('div', { class: 'row3' }, field('Floor', floor, 'Optional. 0 = ground floor', 'f'), field('Size (sqm)', size, 'Optional', 'z'), field('Monthly rate (₱)', rate, 'Optional', 'r')),
        field('Status', status, 'Only Available spaces can be requested.', 's'),
        field('Description', desc, 'Optional. Features, suitable businesses, etc.', 'd'),
        h('div', { class: 'actions' }, save, h('a', { class: 'btn', href: '#/spaces' }, 'Cancel')));
      main.appendChild(h('section', { class: 'card narrow' }, form));

      if (!isNew) {
        var photosBox = h('div', { class: 'photos' });
        var perr = h('p', { class: 'error', role: 'alert' });
        var fileIn = h('input', { id: 'files', type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true });
        var draw = function (sp) {
          photosBox.replaceChildren();
          if (!sp.photos.length) photosBox.appendChild(h('p', { class: 'muted small' }, 'No photos yet. The building photo is shown until you add one.'));
          sp.photos.forEach(function (pid) {
            photosBox.appendChild(h('div', { class: 'photo' },
              h('img', { src: '/api/photos/' + pid, alt: 'Photo of ' + sp.name }),
              h('button', {
                class: 'btn btn--sm btn--danger', type: 'button', 'aria-label': 'Delete this photo',
                style: 'background:#fff', onclick: function () {
                  if (!window.confirm('Delete this photo?')) return;
                  api('DELETE', '/photos/' + pid).then(function (r) { draw(r.space); }).catch(function (x) { perr.textContent = x.message; });
                }
              }, 'Delete')));
          });
        };
        draw(s);
        var upBtn = h('button', {
          class: 'btn', type: 'button', onclick: function () {
            perr.textContent = '';
            if (!fileIn.files.length) { perr.textContent = 'Choose at least one photo.'; return; }
            var fd = new FormData();
            Array.prototype.forEach.call(fileIn.files, function (f) { fd.append('photos', f); });
            upBtn.disabled = true;
            api('POST', '/spaces/' + id + '/photos', fd, true)
              .then(function (r) { fileIn.value = ''; draw(r.space); toast('Photos uploaded.'); })
              .catch(function (x) { perr.textContent = x.message; })
              .then(function () { upBtn.disabled = false; });
          }
        }, 'Upload photos');
        main.appendChild(h('section', { class: 'card narrow' }, h('h2', null, 'Photos'), perr, photosBox,
          field('Add photos', fileIn, 'JPG, PNG or WebP, up to 5 MB each, 10 photos per space.', 'files'), upBtn));

        main.appendChild(h('section', { class: 'card narrow' }, h('h2', null, 'Remove this space'),
          h('p', { class: 'muted small', style: 'margin-bottom:14px' }, 'Past requests keep the space name. To stop new requests without removing it, set the status to Reserved or Occupied instead.'),
          h('button', {
            class: 'btn btn--danger', type: 'button', onclick: function () {
              if (!window.confirm('Delete ' + s.name + '? This cannot be undone.')) return;
              api('DELETE', '/spaces/' + id).then(function () { toast('Space deleted.'); location.hash = '#/spaces'; }).catch(function (x) { toast(x.message, true); });
            }
          }, 'Delete space')));
      }
    });
  }

  function viewSettings(main, tok) {
    main.appendChild(pageHead('Site details'));
    return api('GET', '/settings').then(function (d) {
      if (tok !== state.token) return;
      var s = d.settings;
      var err = h('p', { class: 'error', role: 'alert' });
      var address = h('input', { id: 'a', type: 'text', maxlength: '200', value: s.address, required: true });
      var phone = h('input', { id: 'p', type: 'text', maxlength: '13', value: s.contact_phone, placeholder: '09XX XXX XXXX' });
      var email = h('input', { id: 'e', type: 'email', maxlength: '254', value: s.contact_email });
      var hours = h('textarea', { id: 'h', maxlength: '200', value: s.office_hours, placeholder: 'Mon–Sat, 8:00 AM – 5:00 PM' });
      var url = h('input', { id: 'u', type: 'url', maxlength: '500', value: s.directions_url, placeholder: 'https://maps.app.goo.gl/…' });
      var rates = h('input', { id: 'rates', type: 'checkbox', checked: s.show_rates });
      var save = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Save');
      main.appendChild(h('section', { class: 'card narrow' }, h('form', {
        novalidate: true,
        onsubmit: function (e) {
          e.preventDefault(); err.textContent = ''; save.disabled = true;
          api('PUT', '/settings', { address: address.value, contact_phone: phone.value, contact_email: email.value, office_hours: hours.value, directions_url: url.value, show_rates: rates.checked })
            .then(function () { toast('Saved. The public site now shows these details.'); })
            .catch(function (x) { err.textContent = x.message; })
            .then(function () { save.disabled = false; });
        }
      }, err,
        field('Address', address, null, 'a'),
        h('div', { class: 'row2' }, field('Contact phone', phone, '', 'p'), field('Contact email', email, '', 'e')),
        field('Office hours', hours, 'Optional.', 'h'),
        field('Directions link', url, 'Optional. A Google Maps share link. If empty, a search for the address is used.', 'u'),
        h('div', { class: 'field check' }, rates, h('label', { for: 'rates' }, 'Show monthly rates on the public site')),
        save)));
      SkyPhone.bind(phone);
    });
  }

  function viewPassword(main) {
    var forced = state.admin.must_change_password;
    main.appendChild(pageHead(forced ? 'Set a new password' : 'Change password'));
    if (forced) main.appendChild(h('p', { class: 'notice' }, 'You are using a temporary password. Choose a new one to continue.'));
    var err = h('p', { class: 'error', role: 'alert' });
    var cur = h('input', { id: 'c', type: 'password', autocomplete: 'current-password', required: true });
    var nw = h('input', { id: 'nw', type: 'password', autocomplete: 'new-password', required: true });
    var cf = h('input', { id: 'cf', type: 'password', autocomplete: 'new-password', required: true });
    var save = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Save password');
    main.appendChild(h('section', { class: 'card narrow' }, h('form', {
      novalidate: true,
      onsubmit: function (e) {
        e.preventDefault(); err.textContent = '';
        if (nw.value !== cf.value) { err.textContent = 'The new passwords do not match.'; return; }
        save.disabled = true;
        api('POST', '/password', { current: cur.value, next: nw.value })
          .then(function () { state.admin.must_change_password = false; toast('Password changed.'); location.hash = '#/'; route(); })
          .catch(function (x) { err.textContent = x.message; })
          .then(function () { save.disabled = false; });
      }
    }, err,
      field('Current password', cur, null, 'c'),
      field('New password', nw, 'At least 10 characters, with a letter and a number.', 'nw'),
      field('Confirm new password', cf, null, 'cf'),
      save)));
    return Promise.resolve();
  }

  // ---- router ------------------------------------------------------------------

  function route() {
    if (!state.admin) return showLogin();
    var tok = ++state.token;
    var hash = location.hash || '#/';
    var parts = hash.replace(/^#\/?/, '').split('/');
    var active = 'dash';
    var view;

    if (state.admin.must_change_password) { active = 'password'; view = viewPassword; }
    else if (parts[0] === 'requests' && parts[1]) view = function (m, t) { return viewRequest(m, t, encodeURIComponent(parts[1])); };
    else if (parts[0] === 'spaces' && parts[1]) { active = 'spaces'; view = function (m, t) { return viewSpaceForm(m, t, parts[1] === 'new' ? 'new' : encodeURIComponent(parts[1])); }; }
    else if (parts[0] === 'spaces') { active = 'spaces'; view = viewSpaces; }
    else if (parts[0] === 'settings') { active = 'settings'; view = viewSettings; }
    else if (parts[0] === 'password') { active = 'password'; view = viewPassword; }
    else view = viewDashboard;

    var main = shell(active);
    window.scrollTo(0, 0);
    Promise.resolve(view(main, tok)).catch(function (x) {
      if (tok !== state.token || !state.admin) return;
      if (x.code === 'must_change_password') return;
      main.appendChild(h('p', { class: 'error', role: 'alert' }, x.message || 'Could not load this page.'));
    });
  }

  window.addEventListener('hashchange', route);

  api('GET', '/me').then(function (d) { state.admin = d.admin; route(); }).catch(function () { if (!state.admin) showLogin(); });
})();
