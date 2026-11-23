(function () {
  'use strict';

  var STATUS_LABEL = { reserved: 'Currently reserved', occupied: 'Currently occupied' };
  var ARROW = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
  var INFO = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';

  function photoFor(unit) {
    return unit && Array.isArray(unit.photos) && unit.photos[0] ? unit.photos[0] : '/img/building.png';
  }

  function isAvailable(unit) {
    return !!unit && unit.status === 'available';
  }

  function facebookConfigured(url) {
    if (!url) return false;
    var value = String(url).trim();
    if (!value || value.toUpperCase() === 'LINK_TO_BE_ADDED') return false;
    return /^https:\/\/(www\.)?facebook\.com\//i.test(value);
  }

  function money(value) {
    return '₱' + Number(value).toLocaleString('en-PH', { maximumFractionDigits: 0 });
  }

  function metaLine(unit) {
    var parts = [];
    if (unit.floor !== null && unit.floor !== undefined) {
      parts.push(unit.floor === 0 ? 'Ground floor' : 'Floor ' + unit.floor);
    }
    if (unit.size_sqm) parts.push(unit.size_sqm + ' sqm');
    if (unit.monthly_rate) parts.push(money(unit.monthly_rate) + ' / month');
    return parts.join(' · ');
  }

  window.Sky888Site = {
    photoFor: photoFor,
    isAvailable: isAvailable,
    facebookConfigured: facebookConfigured,
    metaLine: metaLine
  };

  if (typeof document === 'undefined') return;

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderSpaces(units) {
    var box = $('cards');
    if (!box) return;
    box.replaceChildren();
    if (!Array.isArray(units) || !units.length) {
      box.appendChild(el('p', 'muted', 'No spaces are listed yet. Please check back soon.'));
      return;
    }

    units.forEach(function (unit) {
      var open = isAvailable(unit);
      var card = el(open ? 'a' : 'div', 'card' + (open ? '' : ' card--closed'));
      if (open) {
        card.href = '#request';
      }

      var image = el('img', 'card__img');
      image.src = photoFor(unit);
      image.alt = unit.name + ' at SKY888';
      image.loading = 'lazy';
      card.appendChild(image);

      var body = el('div', 'card__body');
      body.appendChild(el('div', 'card__name', unit.name));
      var meta = metaLine(unit);
      if (meta) body.appendChild(el('p', 'card__meta', meta));
      if (unit.description) body.appendChild(el('p', 'card__meta', unit.description));

      var row = el('div', 'card__row');
      if (open) {
        row.appendChild(el('span', 'card__cta', 'Request this space'));
        var arrow = el('span');
        arrow.innerHTML = ARROW;
        row.appendChild(arrow);
      } else {
        row.appendChild(el('span', 'card__status', STATUS_LABEL[unit.status] || 'Not available'));
        var info = el('span');
        info.innerHTML = INFO;
        row.appendChild(info);
      }
      row.style.marginTop = '6px';
      body.appendChild(row);
      card.appendChild(body);
      box.appendChild(card);
    });
  }

  function renderSettings(settings) {
    var address = settings.address || 'Don Rufino Alonzo Sr. St., Brgy. Poblacion 5, Cotabato City 9600';
    var addressNode = $('address');
    if (addressNode) addressNode.textContent = address;

    var directions = $('directions');
    if (directions) {
      directions.href = settings.directionsUrl ||
        'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
    }

    var lines = $('contact-lines');
    if (lines) {
      lines.replaceChildren();
      function line(label, value) {
        if (lines.childNodes.length) lines.appendChild(document.createElement('br'));
        lines.appendChild(document.createTextNode(label + ': ' + (value || 'to be announced')));
      }
      line('Phone', settings.contactPhone);
      line('Email', settings.contactEmail);
      if (settings.officeHours) {
        lines.appendChild(document.createElement('br'));
        lines.appendChild(document.createTextNode(settings.officeHours));
      }
    }

    var facebookStatus = $('facebook-status');
    var facebookLink = $('facebook-link');
    if (facebookStatus && facebookLink) {
      if (facebookConfigured(settings.facebookUrl)) {
        facebookStatus.textContent = 'Open the SKY888 Facebook Page to discuss available spaces.';
        facebookLink.href = settings.facebookUrl;
        facebookLink.target = '_blank';
        facebookLink.rel = 'noopener';
        facebookLink.removeAttribute('aria-disabled');
        facebookLink.classList.remove('is-disabled');
      } else {
        facebookStatus.textContent = 'The Facebook Page link will be added when it is available.';
        facebookLink.href = '#';
        facebookLink.removeAttribute('target');
        facebookLink.removeAttribute('rel');
        facebookLink.setAttribute('aria-disabled', 'true');
        facebookLink.classList.add('is-disabled');
      }
    }
  }

  function loadSite() {
    return Promise.all([
      fetch('/data/units.json', { headers: { Accept: 'application/json' } }),
      fetch('/data/site.json', { headers: { Accept: 'application/json' } })
    ]).then(function (responses) {
      return Promise.all(responses.map(function (response) {
        if (!response.ok) throw new Error('load failed');
        return response.json();
      }));
    }).then(function (data) {
      renderSpaces(data[0]);
      renderSettings(data[1]);
    }).catch(function () {
      var box = $('cards');
      if (box) box.replaceChildren(el('p', 'muted', 'We could not load the spaces right now. Please refresh the page.'));
    });
  }

  window.Sky888Site.renderSpaces = renderSpaces;
  window.Sky888Site.renderSettings = renderSettings;
  window.Sky888Site.loadSite = loadSite;

  var year = $('year');
  if (year) year.textContent = String(new Date().getFullYear());
  loadSite();
})();
