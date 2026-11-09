/* HotelSucher single-page front-end. No framework, no build step. */
(function () {
  'use strict';

  // ======================================================================
  // Utilities
  // ======================================================================

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const app = $('#app');

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const money2 = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
  const fmtMoney = (n) => (Number.isInteger(n) ? money : money2).format(n);

  function pad(n) { return String(n).padStart(2, '0'); }
  function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function today() { return isoDate(new Date()); }
  function addDays(s, n) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDate(d); }
  function nightsBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
  function fmtDate(s, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
    if (!s) return '';
    return new Date(s.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', opts);
  }
  const plural = (n, word, pl) => `${n} ${n === 1 ? word : (pl || word + 's')}`;

  function starsHtml(n) { return n ? `<span class="stars" title="${n}-star property" aria-label="${n} stars">${'★'.repeat(n)}</span>` : ''; }
  function scoreWord(r) {
    if (r == null) return 'New';
    if (r >= 9) return 'Wonderful';
    if (r >= 8.5) return 'Excellent';
    if (r >= 8) return 'Very good';
    if (r >= 7) return 'Good';
    if (r >= 6) return 'Pleasant';
    return 'Review score';
  }
  function scoreHtml(rating, count) {
    if (rating == null) return `<div class="score"><div class="score-text"><strong>New to HotelSucher</strong><span class="small muted">No reviews yet</span></div></div>`;
    return `<div class="score"><div class="score-text"><strong>${scoreWord(rating)}</strong><span class="small muted">${plural(count, 'review')}</span></div><div class="score-badge">${rating.toFixed(1)}</div></div>`;
  }

  const FALLBACK_IMG = 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#003b95"/><stop offset="1" stop-color="#4c8de0"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><text x="200" y="165" font-family="Arial" font-size="56" text-anchor="middle" fill="rgba(255,255,255,.85)">🏨</text></svg>`);
  // Replace any broken image with a branded placeholder.
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && !t.dataset.fallback) { t.dataset.fallback = '1'; t.src = FALLBACK_IMG; }
  }, true);

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  async function api(method, url, body) {
    const res = await fetch('/api' + url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function qs(obj) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, v);
    const s = p.toString();
    return s ? '?' + s : '';
  }

  function navigate(path) { location.hash = '#' + path; }

  const loader = () => '<div class="loader"><div class="spinner" aria-label="Loading"></div></div>';
  const errorBox = (msg) => `<div class="alert alert-error">${esc(msg)}</div>`;

  // ======================================================================
  // State
  // ======================================================================

  const state = {
    user: null,
    destinations: null,
    lastSearch: JSON.parse(sessionStorage.getItem('hs_last_search') || 'null') || {},
  };

  function rememberSearch(s) {
    state.lastSearch = { q: s.q || '', checkIn: s.checkIn || '', checkOut: s.checkOut || '', guests: s.guests || 2, rooms: s.rooms || 1 };
    sessionStorage.setItem('hs_last_search', JSON.stringify(state.lastSearch));
  }

  async function loadDestinations() {
    if (!state.destinations) state.destinations = (await api('GET', '/destinations')).destinations;
    return state.destinations;
  }

  async function refreshUser() {
    try { state.user = (await api('GET', '/auth/me')).user; } catch { state.user = null; }
    renderHeader();
  }

  function renderHeader() {
    const nav = $('#header-nav');
    if (state.user) {
      const initial = esc(state.user.name.trim().charAt(0).toUpperCase() || '?');
      nav.innerHTML = `
        <a class="nav-link optional" href="#/bookings">My bookings</a>
        <div class="user-menu">
          <button type="button" id="user-btn" aria-haspopup="true" aria-expanded="false">
            <span class="avatar">${initial}</span><span>${esc(state.user.name.split(' ')[0])}</span>
          </button>
          <div class="user-dropdown hidden" id="user-dd" role="menu">
            <a href="#/bookings" role="menuitem">🧳 Bookings &amp; trips</a>
            <a href="#/wishlist" role="menuitem">♥ Saved</a>
            <button type="button" id="logout-btn" role="menuitem">↪ Sign out</button>
          </div>
        </div>`;
      const btn = $('#user-btn'), dd = $('#user-dd');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dd.classList.toggle('hidden');
        btn.setAttribute('aria-expanded', String(!dd.classList.contains('hidden')));
      });
      $('#logout-btn').addEventListener('click', async () => {
        await api('POST', '/auth/logout');
        state.user = null;
        renderHeader();
        toast('You have been signed out.');
        navigate('/');
      });
    } else {
      const next = encodeURIComponent(currentPath());
      nav.innerHTML = `
        <a class="nav-link optional" href="#/manage">Manage booking</a>
        <a class="btn-white" href="#/register?next=${next}">Register</a>
        <a class="btn-white" href="#/login?next=${next}">Sign in</a>`;
    }
  }

  function currentPath() { return location.hash.slice(1) || '/'; }

  // ======================================================================
  // Shared components
  // ======================================================================

  /** Renders the yellow search bar and wires up autocomplete, dates and guest picker. */
  function searchBarHtml(s) {
    return `
      <form class="search-bar" id="search-form" autocomplete="off" role="search">
        <div class="field">
          <span class="icon" aria-hidden="true">🛏️</span>
          <label for="sb-q">Destination</label>
          <input id="sb-q" name="q" placeholder="Where are you going?" value="${esc(s.q || '')}" required />
          <div class="autocomplete hidden" id="sb-ac"></div>
        </div>
        <div class="field">
          <span class="icon" aria-hidden="true">📅</span>
          <label for="sb-in">Check-in</label>
          <input id="sb-in" name="checkIn" type="date" min="${today()}" value="${esc(s.checkIn || '')}" />
        </div>
        <div class="field">
          <span class="icon" aria-hidden="true">📅</span>
          <label for="sb-out">Check-out</label>
          <input id="sb-out" name="checkOut" type="date" min="${addDays(s.checkIn || today(), 1)}" value="${esc(s.checkOut || '')}" />
        </div>
        <div class="field">
          <span class="icon" aria-hidden="true">👤</span>
          <label>Guests</label>
          <button type="button" class="guests-trigger" id="sb-guests-btn"></button>
          <div class="guests-pop hidden" id="sb-guests-pop">
            <div class="counter-row"><span>Guests</span><div class="counter" data-key="guests" data-min="1" data-max="30"><button type="button" data-d="-1" aria-label="Fewer guests">−</button><span></span><button type="button" data-d="1" aria-label="More guests">+</button></div></div>
            <div class="counter-row"><span>Rooms</span><div class="counter" data-key="rooms" data-min="1" data-max="8"><button type="button" data-d="-1" aria-label="Fewer rooms">−</button><span></span><button type="button" data-d="1" aria-label="More rooms">+</button></div></div>
            <button type="button" class="btn btn-outline btn-block" id="sb-guests-done">Done</button>
          </div>
        </div>
        <button class="btn btn-primary" type="submit">Search</button>
      </form>
      <div id="search-error"></div>`;
  }

  function wireSearchBar(s, onSubmit) {
    const form = $('#search-form');
    const counts = { guests: Number(s.guests) || 2, rooms: Number(s.rooms) || 1 };
    const qIn = $('#sb-q'), inEl = $('#sb-in'), outEl = $('#sb-out');
    const ac = $('#sb-ac');
    const pop = $('#sb-guests-pop'), gBtn = $('#sb-guests-btn');

    function renderCounts() {
      gBtn.textContent = `${plural(counts.guests, 'guest')} · ${plural(counts.rooms, 'room')}`;
      $$('.counter', pop).forEach((c) => {
        const k = c.dataset.key;
        c.querySelector('span').textContent = counts[k];
        c.querySelector('[data-d="-1"]').disabled = counts[k] <= Number(c.dataset.min);
        c.querySelector('[data-d="1"]').disabled = counts[k] >= Number(c.dataset.max);
      });
    }
    renderCounts();
    gBtn.addEventListener('click', (e) => { e.stopPropagation(); pop.classList.toggle('hidden'); });
    pop.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('button[data-d]');
      if (!b) return;
      const c = b.closest('.counter');
      counts[c.dataset.key] = Math.min(Number(c.dataset.max), Math.max(Number(c.dataset.min), counts[c.dataset.key] + Number(b.dataset.d)));
      if (counts.rooms > counts.guests) counts.guests = counts.rooms;
      renderCounts();
    });
    $('#sb-guests-done').addEventListener('click', () => pop.classList.add('hidden'));

    inEl.addEventListener('change', () => {
      if (!inEl.value) return;
      outEl.min = addDays(inEl.value, 1);
      if (!outEl.value || outEl.value <= inEl.value) outEl.value = addDays(inEl.value, 1);
    });

    // Autocomplete
    let acIndex = -1;
    async function showAc() {
      const dests = await loadDestinations().catch(() => []);
      const term = qIn.value.trim().toLowerCase();
      const list = dests.filter((d) => !term || d.city.toLowerCase().includes(term) || d.country.toLowerCase().includes(term)).slice(0, 7);
      acIndex = -1;
      if (!list.length) { ac.classList.add('hidden'); return; }
      ac.innerHTML = list.map((d) => `<button type="button" data-city="${esc(d.city)}"><span>📍</span><span><strong>${esc(d.city)}</strong><br><span class="small muted">${esc(d.country)} · ${plural(d.properties, 'property', 'properties')}</span></span></button>`).join('');
      ac.classList.remove('hidden');
    }
    qIn.addEventListener('focus', showAc);
    qIn.addEventListener('input', showAc);
    qIn.addEventListener('keydown', (e) => {
      const items = $$('button', ac);
      if (ac.classList.contains('hidden') || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        acIndex = (acIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((b, i) => b.classList.toggle('active', i === acIndex));
      } else if (e.key === 'Enter' && acIndex >= 0) {
        e.preventDefault();
        qIn.value = items[acIndex].dataset.city;
        ac.classList.add('hidden');
      } else if (e.key === 'Escape') ac.classList.add('hidden');
    });
    ac.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-city]');
      if (!b) return;
      qIn.value = b.dataset.city;
      ac.classList.add('hidden');
      if (!inEl.value) inEl.focus();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const err = $('#search-error');
      err.innerHTML = '';
      const values = { q: qIn.value.trim(), checkIn: inEl.value, checkOut: outEl.value, guests: counts.guests, rooms: counts.rooms };
      if (!values.q) { err.innerHTML = errorBox('Please enter a destination to start searching.'); return; }
      if ((values.checkIn && !values.checkOut) || (!values.checkIn && values.checkOut)) { err.innerHTML = errorBox('Please select both check-in and check-out dates.'); return; }
      if (values.checkIn && values.checkOut <= values.checkIn) { err.innerHTML = errorBox('Check-out must be after check-in.'); return; }
      if (values.checkIn && nightsBetween(values.checkIn, values.checkOut) > 30) { err.innerHTML = errorBox('Reservations longer than 30 nights are not possible.'); return; }
      rememberSearch(values);
      onSubmit(values);
    });
  }

  async function toggleWishlist(btn) {
    if (!state.user) {
      toast('Sign in to save properties to your list.');
      navigate('/login?next=' + encodeURIComponent(currentPath()));
      return;
    }
    const id = btn.dataset.hotel;
    const saved = btn.classList.contains('saved');
    try {
      await api(saved ? 'DELETE' : 'PUT', `/wishlist/${id}`);
      btn.classList.toggle('saved', !saved);
      btn.textContent = saved ? '♡' : '♥';
      btn.setAttribute('aria-label', saved ? 'Save property' : 'Remove from saved');
      toast(saved ? 'Removed from your saved list.' : 'Saved to your list ♥');
    } catch (err) { toast(err.message); }
  }
  // Close popovers when clicking elsewhere.
  document.addEventListener('click', (e) => {
    $$('.user-dropdown, .guests-pop, .autocomplete').forEach((el) => {
      if (el.contains(e.target)) return;
      if (el.classList.contains('autocomplete') && e.target.id === 'sb-q') return;
      el.classList.add('hidden');
    });
  });

  // Global delegation for heart buttons.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.heart[data-hotel]');
    if (b) { e.preventDefault(); e.stopPropagation(); toggleWishlist(b); }
  });

  function heartHtml(h) {
    return `<button type="button" class="heart ${h.saved ? 'saved' : ''}" data-hotel="${h.id}" aria-label="${h.saved ? 'Remove from saved' : 'Save property'}">${h.saved ? '♥' : '♡'}</button>`;
  }

  function stayQuery(s) {
    return qs({ checkIn: s.checkIn, checkOut: s.checkOut, guests: s.guests, rooms: s.rooms });
  }

  // ======================================================================
  // Views
  // ======================================================================

  const PROPERTY_TYPES = [
    ['Hotel', '🏨'], ['Apartment', '🏢'], ['Resort', '🏝️'], ['Boutique Hotel', '✨'], ['Guesthouse', '🏡'], ['Hostel', '🛏️'],
  ];

  async function viewHome() {
    const s = state.lastSearch;
    app.innerHTML = `
      <section class="hero"><div class="container">
        <h1>Find your next stay</h1>
        <p>Search low prices on hotels, homes and much more…</p>
      </div></section>
      <div class="container search-wrap">${searchBarHtml(s)}</div>

      <section class="section"><div class="container">
        <div class="usp">
          <div class="card"><span class="emoji">💶</span><div><strong>Best price, no booking fees</strong><p class="muted small" style="margin:0">The price you see is the price you pay.</p></div></div>
          <div class="card"><span class="emoji">🔄</span><div><strong>Free cancellation on most stays</strong><p class="muted small" style="margin:0">Plans change — look for the green label.</p></div></div>
          <div class="card"><span class="emoji">⭐</span><div><strong>Real guest reviews</strong><p class="muted small" style="margin:0">Only guests who booked can leave a review.</p></div></div>
        </div>
      </div></section>

      <section class="section" style="padding-top:0"><div class="container">
        <h2>Trending destinations</h2>
        <p class="muted">Most popular choices for travellers on HotelSucher</p>
        <div class="grid-dest" id="dest-grid">${loader()}</div>
      </div></section>

      <section class="section" style="padding-top:0"><div class="container">
        <h2>Browse by property type</h2>
        <div class="grid-types">
          ${PROPERTY_TYPES.map(([t, e]) => `<a class="type-card" href="#/search${qs({ types: t })}"><span class="emoji">${e}</span><strong>${esc(t)}s</strong></a>`).join('')}
        </div>
      </div></section>

      <section class="section" style="padding-top:0"><div class="container promo">
        <div class="card promo-dark">
          <div><h3>Sign in, save money</h3><p>Keep track of all your trips in one place, save your favourite properties and write reviews after your stay.</p></div>
          <div>${state.user ? '<a class="btn btn-primary" href="#/bookings">View my trips</a>' : '<a class="btn btn-primary" href="#/login">Sign in</a> <a class="btn btn-outline" href="#/register">Register</a>'}</div>
        </div>
        <div class="card">
          <div><h3>Already booked?</h3><p class="muted">Look up any reservation with your booking reference and email address — no account required.</p></div>
          <div><a class="btn btn-outline" href="#/manage">Find my booking</a></div>
        </div>
      </div></section>`;

    wireSearchBar(s, (v) => navigate('/search' + qs(v)));

    try {
      const dests = await loadDestinations();
      const grid = $('#dest-grid');
      if (!grid) return;
      grid.innerHTML = dests.slice(0, 8).map((d) => `
        <a class="dest-card" href="#/search${qs({ q: d.city, checkIn: s.checkIn, checkOut: s.checkOut, guests: s.guests, rooms: s.rooms })}">
          <img src="${esc(d.image)}" alt="${esc(d.city)}" loading="lazy" />
          <div class="dest-label"><strong>${esc(d.city)}</strong><span>${esc(d.country)} · ${plural(d.properties, 'property', 'properties')}</span></div>
        </a>`).join('');
    } catch (err) {
      $('#dest-grid').innerHTML = errorBox(err.message);
    }
  }

  // ---------------------------------------------------------------------

  const AMENITY_FILTERS = ['Free WiFi', 'Parking', 'Swimming pool', 'Fitness centre', 'Spa', 'Restaurant', 'Airport shuttle', 'Pet friendly', 'Family rooms', 'Kitchen'];
  const SORTS = [['recommended', 'Our top picks'], ['price_asc', 'Price (lowest first)'], ['price_desc', 'Price (highest first)'], ['rating', 'Best reviewed'], ['stars', 'Property rating (high to low)'], ['distance', 'Distance from centre']];

  async function viewSearch(params) {
    const p = Object.fromEntries(params);
    const s = { q: p.q || '', checkIn: p.checkIn || '', checkOut: p.checkOut || '', guests: p.guests || 2, rooms: p.rooms || 1 };
    if (s.q || s.checkIn) rememberSearch(s);
    const listParam = (k) => (p[k] ? p[k].split(',').filter(Boolean) : []);
    const selStars = listParam('stars'), selTypes = listParam('types'), selAmen = listParam('amenities');

    app.innerHTML = `
      <div style="background:var(--brand);padding:16px 0 20px"><div class="container">${searchBarHtml(s)}</div></div>
      <div class="container"><div class="breadcrumbs"><a href="#/">Home</a> › Search results${s.q ? ' › ' + esc(s.q) : ''}</div></div>
      <div class="container results-layout">
        <aside class="filters" id="filters">
          <div class="card">
            <h3>Filter by:</h3>
            <div class="filter-group">
              <h4>Your budget (per night)</h4>
              <div class="price-inputs">
                <input type="number" min="0" placeholder="Min €" id="f-min" value="${esc(p.minPrice || '')}" aria-label="Minimum price" />
                <span>–</span>
                <input type="number" min="0" placeholder="Max €" id="f-max" value="${esc(p.maxPrice || '')}" aria-label="Maximum price" />
              </div>
              <button type="button" class="btn btn-outline btn-block" id="f-price" style="margin-top:8px;padding:6px">Apply</button>
            </div>
            <div class="filter-group">
              <h4>Popular filters</h4>
              <label><input type="checkbox" data-flag="freeCancellation" ${p.freeCancellation === '1' ? 'checked' : ''}/> Free cancellation</label>
              <label><input type="checkbox" data-flag="breakfast" ${p.breakfast === '1' ? 'checked' : ''}/> Breakfast included</label>
              <label><input type="checkbox" data-flag="maxDistance" data-value="2" ${p.maxDistance === '2' ? 'checked' : ''}/> Less than 2 km from centre</label>
            </div>
            <div class="filter-group">
              <h4>Review score</h4>
              ${[['', 'Any'], ['9', 'Wonderful: 9+'], ['8', 'Very good: 8+'], ['7', 'Good: 7+'], ['6', 'Pleasant: 6+']].map(([v, l]) =>
                `<label><input type="radio" name="minRating" value="${v}" ${(p.minRating || '') === v ? 'checked' : ''}/> ${l}</label>`).join('')}
            </div>
            <div class="filter-group">
              <h4>Property rating</h4>
              ${[5, 4, 3, 2, 1].map((n) => `<label><input type="checkbox" data-list="stars" value="${n}" ${selStars.includes(String(n)) ? 'checked' : ''}/> ${plural(n, 'star')} ${starsHtml(n)}</label>`).join('')}
            </div>
            <div class="filter-group">
              <h4>Property type</h4>
              ${PROPERTY_TYPES.map(([t]) => `<label><input type="checkbox" data-list="types" value="${esc(t)}" ${selTypes.includes(t) ? 'checked' : ''}/> ${esc(t)}s</label>`).join('')}
            </div>
            <div class="filter-group">
              <h4>Facilities</h4>
              ${AMENITY_FILTERS.map((a) => `<label><input type="checkbox" data-list="amenities" value="${esc(a)}" ${selAmen.includes(a) ? 'checked' : ''}/> ${esc(a)}</label>`).join('')}
            </div>
            <div class="filter-group"><a href="#/search${qs({ q: s.q, checkIn: s.checkIn, checkOut: s.checkOut, guests: s.guests, rooms: s.rooms })}">Clear all filters</a></div>
          </div>
        </aside>
        <section>
          <div class="results-head">
            <div><h1 style="font-size:22px;margin:0" id="results-title">Searching…</h1><div class="muted small" id="results-sub"></div></div>
            <div style="display:flex;gap:8px;align-items:center">
              <button class="btn btn-outline filters-toggle" type="button" id="filters-toggle">⚙ Filters</button>
              <label class="sr-only" for="sort">Sort by</label>
              <select id="sort">${SORTS.map(([v, l]) => `<option value="${v}" ${(p.sort || 'recommended') === v ? 'selected' : ''}>Sort by: ${l}</option>`).join('')}</select>
            </div>
          </div>
          <div id="results">${loader()}</div>
        </section>
      </div>`;

    wireSearchBar(s, (v) => {
      const next = { ...p, ...v, page: '' };
      navigate('/search' + qs(next));
    });

    function update(changes) { navigate('/search' + qs({ ...p, page: '', ...changes })); }

    $('#sort').addEventListener('change', (e) => update({ sort: e.target.value === 'recommended' ? '' : e.target.value }));
    $('#filters-toggle').addEventListener('click', () => $('#filters').classList.toggle('open'));
    $('#f-price').addEventListener('click', () => update({ minPrice: $('#f-min').value, maxPrice: $('#f-max').value }));
    $$('input[data-flag]').forEach((cb) => cb.addEventListener('change', () => update({ [cb.dataset.flag]: cb.checked ? (cb.dataset.value || '1') : '' })));
    $$('input[name="minRating"]').forEach((r) => r.addEventListener('change', () => update({ minRating: r.value })));
    $$('input[data-list]').forEach((cb) => cb.addEventListener('change', () => {
      const key = cb.dataset.list;
      const vals = $$(`input[data-list="${key}"]:checked`).map((c) => c.value);
      update({ [key]: vals.join(',') });
    }));

    const resultsEl = $('#results');
    try {
      const data = await api('GET', '/hotels' + qs(p));
      const title = $('#results-title');
      if (!title) return; // navigated away
      title.textContent = `${s.q ? s.q + ': ' : ''}${plural(data.total, 'property', 'properties')} found`;
      $('#results-sub').textContent = data.stay
        ? `${fmtDate(data.stay.checkIn)} – ${fmtDate(data.stay.checkOut)} · ${plural(data.stay.nights, 'night')}, ${plural(data.guests, 'guest')}, ${plural(data.rooms, 'room')}`
        : 'Add your dates to see live availability and total prices.';

      if (!data.results.length) {
        resultsEl.innerHTML = `<div class="empty card"><div class="emoji">🔍</div><h3>No properties match your search</h3><p class="muted">Try changing your dates, removing some filters or searching another destination.</p></div>`;
        return;
      }
      resultsEl.innerHTML = data.results.map((h) => hotelCardHtml(h, data, s)).join('') + paginationHtml(data);
      $$('.pagination button[data-page]', resultsEl).forEach((b) => b.addEventListener('click', () => {
        update({ page: b.dataset.page === '1' ? '' : b.dataset.page });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }));
    } catch (err) {
      resultsEl.innerHTML = errorBox(err.message);
    }
  }

  function hotelCardHtml(h, data, s) {
    const link = `#/hotel/${h.id}${stayQuery(s)}`;
    const priceBlock = data.stay
      ? `<div class="small muted">${plural(data.stay.nights, 'night')}, ${plural(data.guests, 'adult')}</div>
         <div class="price-big">${fmtMoney(h.totalPrice)}</div>
         <div class="small muted">Includes taxes and fees</div>`
      : `<div class="small muted">Prices from</div><div class="price-big">${fmtMoney(h.pricePerNight)}</div><div class="small muted">per night</div>`;
    return `
      <article class="hotel-card">
        <a class="thumb" href="${link}">
          <img src="${esc(h.images[0])}" alt="${esc(h.name)}" loading="lazy" />
          ${heartHtml(h)}
        </a>
        <div>
          <h3><a href="${link}">${esc(h.name)}</a> ${starsHtml(h.stars)}</h3>
          <div class="hotel-meta">
            <a href="${link}">${esc(h.city)}</a>
            <span class="muted">· ${h.distanceKm} km from centre</span>
            <span class="muted">· ${esc(h.propertyType)}</span>
          </div>
          <div class="small"><strong>${esc(h.cheapestRoom.name)}</strong><br><span class="muted">${esc(h.cheapestRoom.beds)}</span></div>
          <div class="tags">
            ${h.freeCancellation ? '<span class="tag tag-green">✓ Free cancellation</span>' : '<span class="tag">Non-refundable</span>'}
            ${h.breakfastIncluded ? '<span class="tag tag-green">☕ Breakfast included</span>' : ''}
            <span class="tag tag-green">No prepayment needed</span>
          </div>
          ${data.stay && h.roomsLeft <= 3 ? `<div class="small red bold">Only ${plural(h.roomsLeft, 'room')} left at this price on our site</div>` : ''}
          <div class="small muted">${h.amenities.slice(0, 4).map(esc).join(' · ')}</div>
        </div>
        <div class="hotel-side">
          ${scoreHtml(h.rating, h.reviewCount)}
          <div>${priceBlock}<a class="btn btn-primary" href="${link}" style="margin-top:8px">See availability ›</a></div>
        </div>
      </article>`;
  }

  function paginationHtml(d) {
    if (d.pages <= 1) return '';
    let html = `<nav class="pagination" aria-label="Pages"><button data-page="${d.page - 1}" ${d.page === 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>`;
    for (let i = 1; i <= d.pages; i++) html += `<button data-page="${i}" class="${i === d.page ? 'active' : ''}">${i}</button>`;
    return html + `<button data-page="${d.page + 1}" ${d.page === d.pages ? 'disabled' : ''} aria-label="Next page">›</button></nav>`;
  }

  // ---------------------------------------------------------------------

  async function viewHotel(id, params) {
    const p = Object.fromEntries(params);
    const s = { checkIn: p.checkIn || state.lastSearch.checkIn || '', checkOut: p.checkOut || state.lastSearch.checkOut || '', guests: p.guests || state.lastSearch.guests || 2, rooms: p.rooms || state.lastSearch.rooms || 1 };
    if (s.checkIn && s.checkIn < today()) { s.checkIn = ''; s.checkOut = ''; }
    app.innerHTML = `<div class="container">${loader()}</div>`;
    let data;
    try {
      data = await api('GET', `/hotels/${encodeURIComponent(id)}` + stayQuery(s));
    } catch (err) {
      app.innerHTML = `<div class="container section">${errorBox(err.message)}<a href="#/">← Back to home</a></div>`;
      return;
    }
    const h = data.hotel;
    const bbox = [h.lng - 0.012, h.lat - 0.007, h.lng + 0.012, h.lat + 0.007].join(',');

    app.innerHTML = `
      <div class="container">
        <div class="breadcrumbs"><a href="#/">Home</a> › <a href="#/search${qs({ q: h.country })}">${esc(h.country)}</a> › <a href="#/search${qs({ q: h.city, ...s })}">${esc(h.city)}</a> › ${esc(h.name)}</div>
        <div class="hotel-header">
          <div>
            <div class="small muted">${esc(h.propertyType)} ${starsHtml(h.stars)}</div>
            <h1>${esc(h.name)}</h1>
            <div class="small">📍 ${esc(h.address)} – <a href="#map">Show on map</a> · <span class="muted">${h.distanceKm} km from centre</span></div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button type="button" class="heart ${h.saved ? 'saved' : ''}" data-hotel="${h.id}" style="position:static" aria-label="Save property">${h.saved ? '♥' : '♡'}</button>
            <a class="btn btn-primary" href="#rooms">Reserve</a>
          </div>
        </div>
        <div class="gallery">${h.images.map((src, i) => `<img src="${esc(src)}" alt="${esc(h.name)} photo ${i + 1}" data-idx="${i}" ${i ? 'loading="lazy"' : ''}/>`).join('')}</div>

        <div class="hotel-body">
          <div>
            <p style="font-size:15px">${esc(h.description)}</p>
            <h3>Most popular facilities</h3>
            <ul class="amenity-list">${h.amenities.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
            <div class="tags">
              ${h.freeCancellation ? '<span class="tag tag-green">✓ Free cancellation before check-in</span>' : '<span class="tag">Non-refundable rates</span>'}
              ${h.breakfastIncluded ? '<span class="tag tag-green">☕ Breakfast included</span>' : ''}
            </div>
          </div>
          <aside>
            <div class="card card-pad" style="margin-bottom:12px">
              ${scoreHtml(h.rating, h.reviewCount)}
              ${data.reviews[0] ? `<p class="small" style="margin:10px 0 0">“${esc(data.reviews[0].comment)}”<br><span class="muted">— ${esc(data.reviews[0].author_name)}, ${esc(data.reviews[0].author_country)}</span></p>` : ''}
            </div>
            <iframe id="map" class="map-frame" title="Map of ${esc(h.name)}" loading="lazy"
              src="https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${h.lat},${h.lng}"></iframe>
            <a class="small" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${h.lat}&mlon=${h.lng}#map=16/${h.lat}/${h.lng}">View larger map ↗</a>
          </aside>
        </div>

        <section class="section" id="rooms">
          <h2>Availability</h2>
          <form class="availability-bar" id="avail-form">
            <div class="field"><label for="av-in">Check-in</label><input type="date" id="av-in" min="${today()}" value="${esc(s.checkIn)}" required /></div>
            <div class="field"><label for="av-out">Check-out</label><input type="date" id="av-out" min="${addDays(s.checkIn || today(), 1)}" value="${esc(s.checkOut)}" required /></div>
            <div class="field"><label for="av-g">Guests / rooms</label>
              <div style="display:flex;gap:6px">
                <select id="av-g" aria-label="Guests">${Array.from({ length: 12 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${Number(s.guests) === n ? 'selected' : ''}>${plural(n, 'guest')}</option>`).join('')}</select>
                <select id="av-r" aria-label="Rooms">${Array.from({ length: 8 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${Number(s.rooms) === n ? 'selected' : ''}>${plural(n, 'room')}</option>`).join('')}</select>
              </div>
            </div>
            <button class="btn btn-primary" type="submit">Check availability</button>
          </form>
          <div id="avail-error"></div>
          ${data.stay ? `<p class="muted">Showing prices for <strong>${plural(data.stay.nights, 'night')}</strong> (${fmtDate(data.stay.checkIn)} – ${fmtDate(data.stay.checkOut)}), ${plural(data.guests, 'guest')}, ${plural(data.rooms, 'room')}.</p>`
                      : '<div class="alert alert-info">Select dates to see availability and the total price for your stay.</div>'}
          <table class="rooms-table">
            <thead><tr><th>Room type</th><th>Sleeps</th><th>Price${data.stay ? ` for ${plural(data.stay.nights, 'night')}` : ' per night'}</th><th>Your choices</th><th></th></tr></thead>
            <tbody>${data.roomTypes.map((r) => roomRowHtml(r, h, data)).join('')}</tbody>
          </table>
        </section>

        <section class="section" id="reviews">
          <h2>Guest reviews</h2>
          ${h.rating != null ? `<div class="review-summary"><div class="score-badge">${h.rating.toFixed(1)}</div><div><strong>${scoreWord(h.rating)}</strong> · ${plural(h.reviewCount, 'review')}</div></div>` : '<p class="muted">No reviews yet.</p>'}
          <div id="review-form-slot"></div>
          <div class="reviews-grid">${data.reviews.map(reviewHtml).join('')}</div>
        </section>
      </div>`;

    // Gallery lightbox
    $$('.gallery img').forEach((img) => img.addEventListener('click', () => openLightbox(h.images, Number(img.dataset.idx))));

    // Availability form
    const inEl = $('#av-in'), outEl = $('#av-out');
    inEl.addEventListener('change', () => {
      outEl.min = addDays(inEl.value, 1);
      if (!outEl.value || outEl.value <= inEl.value) outEl.value = addDays(inEl.value, 1);
    });
    $('#avail-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (outEl.value <= inEl.value) { $('#avail-error').innerHTML = errorBox('Check-out must be after check-in.'); return; }
      const next = { checkIn: inEl.value, checkOut: outEl.value, guests: $('#av-g').value, rooms: $('#av-r').value };
      rememberSearch({ ...state.lastSearch, ...next });
      navigate(`/hotel/${h.id}${stayQuery(next)}#rooms`);
    });

    // Reserve buttons
    $$('button[data-room]').forEach((b) => b.addEventListener('click', () => {
      if (!data.stay) {
        $('#avail-error').innerHTML = errorBox('Please choose your check-in and check-out dates first.');
        inEl.focus();
        return;
      }
      navigate('/book' + qs({ hotel: h.id, room: b.dataset.room, checkIn: data.stay.checkIn, checkOut: data.stay.checkOut, guests: data.guests, rooms: data.rooms }));
    }));

    if (data.canReview) renderReviewForm(h);
  }

  function roomRowHtml(r, h, data) {
    let status;
    if (!r.fits) status = `<span class="red small">Sleeps ${r.maxGuests} per room — add rooms for ${plural(data.guests, 'guest')}</span>`;
    else if (data.stay && r.available === 0) status = '<span class="red small bold">Sold out for your dates</span>';
    else if (data.stay && r.available < data.rooms) status = `<span class="red small">Only ${plural(r.available, 'room')} left</span>`;
    else if (data.stay && r.available <= 3) status = `<span class="red small bold">Only ${plural(r.available, 'room')} left on our site</span>`;
    else status = '';
    return `
      <tr class="${r.bookable ? '' : 'unavailable'}">
        <td>
          <div class="room-name">${esc(r.name)}</div>
          <div class="small">🛏 ${esc(r.beds)} · ${r.sizeSqm} m²</div>
          <div class="small muted">${esc(r.description)}</div>
        </td>
        <td>${'👤'.repeat(Math.min(r.maxGuests, 4))}<div class="small muted">up to ${r.maxGuests}</div></td>
        <td>
          <div class="price-big" style="font-size:18px">${fmtMoney(data.stay ? r.totalPrice : r.pricePerNight)}</div>
          <div class="small muted">${data.stay ? `${fmtMoney(r.pricePerNight)} × ${plural(r.nights, 'night')}${data.rooms > 1 ? ` × ${data.rooms} rooms` : ''}` : 'per night, per room'}</div>
        </td>
        <td class="small">
          ${h.freeCancellation ? '<div class="green bold">✓ Free cancellation</div>' : '<div>Non-refundable</div>'}
          ${h.breakfastIncluded ? '<div class="green">☕ Breakfast included</div>' : '<div class="muted">Breakfast available on site</div>'}
          <div class="green">✓ No prepayment needed</div>
          ${status}
        </td>
        <td><button type="button" class="btn btn-primary" data-room="${r.id}" ${data.stay && !r.bookable ? 'disabled' : ''}>Reserve</button></td>
      </tr>`;
  }

  function reviewHtml(r) {
    return `
      <div class="review">
        <div class="review-head">
          <div style="display:flex;gap:8px;align-items:center">
            <span class="avatar">${esc(r.author_name.charAt(0).toUpperCase())}</span>
            <div><strong>${esc(r.author_name)}</strong><div class="small muted">${esc(r.author_country)}</div></div>
          </div>
          <div class="score-badge">${r.rating}</div>
        </div>
        <div class="small muted" style="margin-top:6px">Reviewed: ${fmtDate(r.created_at, { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <h4 style="margin:6px 0 4px">${esc(r.title)}</h4>
        <p style="margin:0">${esc(r.comment)}</p>
      </div>`;
  }

  function renderReviewForm(h) {
    const slot = $('#review-form-slot');
    let score = 0;
    slot.innerHTML = `
      <form class="card card-pad" id="review-form" style="margin-bottom:16px">
        <h3>How was your stay at ${esc(h.name)}?</h3>
        <div class="form-field"><label>Your score</label>
          <div class="score-picker">${Array.from({ length: 10 }, (_, i) => `<button type="button" data-score="${i + 1}">${i + 1}</button>`).join('')}</div>
        </div>
        <div class="form-grid" style="margin-top:12px">
          <div class="form-field"><label for="rv-title">Title</label><input id="rv-title" maxlength="100" required /></div>
          <div class="form-field"><label for="rv-country">Your country (optional)</label><input id="rv-country" maxlength="60" /></div>
          <div class="form-field full"><label for="rv-comment">Your review</label><textarea id="rv-comment" rows="3" maxlength="2000" required></textarea></div>
        </div>
        <div id="rv-error"></div>
        <button class="btn btn-primary" type="submit" style="margin-top:10px">Submit review</button>
      </form>`;
    $$('.score-picker button', slot).forEach((b) => b.addEventListener('click', () => {
      score = Number(b.dataset.score);
      $$('.score-picker button', slot).forEach((x) => x.classList.toggle('active', Number(x.dataset.score) <= score));
    }));
    $('#review-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!score) { $('#rv-error').innerHTML = errorBox('Please choose a score from 1 to 10.'); return; }
      try {
        await api('POST', `/hotels/${h.id}/reviews`, { rating: score, title: $('#rv-title').value, comment: $('#rv-comment').value, country: $('#rv-country').value });
        toast('Thanks! Your review has been published.');
        route();
      } catch (err) { $('#rv-error').innerHTML = errorBox(err.message); }
    });
  }

  function openLightbox(images, idx) {
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.innerHTML = `<img alt="Property photo" /><button class="lb-close" aria-label="Close">×</button><button class="lb-prev" aria-label="Previous">‹</button><button class="lb-next" aria-label="Next">›</button>`;
    const img = box.querySelector('img');
    const show = () => { img.src = images[idx]; };
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
    const move = (d) => { idx = (idx + d + images.length) % images.length; show(); };
    function onKey(e) { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') move(-1); if (e.key === 'ArrowRight') move(1); }
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    box.querySelector('.lb-close').addEventListener('click', close);
    box.querySelector('.lb-prev').addEventListener('click', () => move(-1));
    box.querySelector('.lb-next').addEventListener('click', () => move(1));
    document.addEventListener('keydown', onKey);
    show();
    document.body.appendChild(box);
  }

  // ---------------------------------------------------------------------

  function stepsHtml(current) {
    const steps = ['Your selection', 'Your details', 'Booking confirmed'];
    return `<div class="steps">${steps.map((s, i) => `${i ? '<span class="line"></span>' : ''}<span class="${i < current ? 'done' : i === current ? 'current' : ''}"><span class="step-num">${i < current ? '✓' : i + 1}</span>${s}</span>`).join('')}</div>`;
  }

  async function viewBook(params) {
    const p = Object.fromEntries(params);
    app.innerHTML = `<div class="container">${loader()}</div>`;
    let data;
    try {
      if (!p.hotel || !p.room || !p.checkIn || !p.checkOut) throw new Error('Your booking selection is incomplete. Please choose a room again.');
      data = await api('GET', `/hotels/${encodeURIComponent(p.hotel)}` + stayQuery(p));
    } catch (err) {
      app.innerHTML = `<div class="container section">${errorBox(err.message)}<a href="#/">← Back to home</a></div>`;
      return;
    }
    const h = data.hotel;
    const room = data.roomTypes.find((r) => String(r.id) === String(p.room));
    if (!room) {
      app.innerHTML = `<div class="container section">${errorBox('That room could not be found.')}<a href="#/hotel/${h.id}">← Back to property</a></div>`;
      return;
    }
    const u = state.user;
    const [first, ...rest] = (u?.name || '').split(' ');

    app.innerHTML = `
      <div class="container">
        ${stepsHtml(1)}
        <div class="booking-layout">
          <aside>
            <div class="card card-pad" style="margin-bottom:12px">
              <div class="small muted">${esc(h.propertyType)} ${starsHtml(h.stars)}</div>
              <h3 style="margin:2px 0">${esc(h.name)}</h3>
              <div class="small">${esc(h.address)}</div>
              ${h.rating != null ? `<div style="margin-top:8px;display:flex;gap:6px;align-items:center"><span class="score-badge">${h.rating.toFixed(1)}</span><span class="small">${scoreWord(h.rating)} · ${plural(h.reviewCount, 'review')}</span></div>` : ''}
            </div>
            <div class="card summary-card" style="margin-bottom:12px">
              <div class="card-pad">
                <h3>Your booking details</h3>
                <div class="row"><div><div class="small muted">Check-in</div><strong>${fmtDate(data.stay.checkIn)}</strong><div class="small muted">From 15:00</div></div>
                  <div><div class="small muted">Check-out</div><strong>${fmtDate(data.stay.checkOut)}</strong><div class="small muted">Until 11:00</div></div></div>
                <div style="margin-top:8px"><div class="small muted">Total length of stay:</div><strong>${plural(data.stay.nights, 'night')}</strong></div>
                <hr style="border:0;border-top:1px solid var(--border)">
                <div class="small muted">You selected</div>
                <strong>${data.rooms > 1 ? data.rooms + ' × ' : ''}${esc(room.name)}</strong> <span class="small">for ${plural(data.guests, 'guest')}</span>
                <div><a href="#/hotel/${h.id}${stayQuery(p)}">Change your selection</a></div>
              </div>
            </div>
            <div class="card summary-card" style="overflow:hidden">
              <div class="card-pad">
                <h3>Your price summary</h3>
                <div class="row"><span>${esc(room.name)} × ${data.rooms}</span><span>${fmtMoney(room.pricePerNight)} / night</span></div>
                <div class="row"><span>${plural(data.stay.nights, 'night')}</span><span>${fmtMoney(room.totalPrice)}</span></div>
                <div class="row small muted"><span>VAT & city tax</span><span>Included</span></div>
              </div>
              <div class="summary-total"><strong style="font-size:18px">Price</strong><div style="text-align:right"><div class="price-big">${fmtMoney(room.totalPrice)}</div><div class="small muted">Includes taxes and fees</div></div></div>
            </div>
            <div class="card card-pad" style="margin-top:12px">
              <h4>Cancellation policy</h4>
              ${h.freeCancellation
                ? `<p class="green small" style="margin:0">✓ Free cancellation any time before ${fmtDate(data.stay.checkIn)}.</p>`
                : '<p class="small" style="margin:0">This is a non-refundable rate. The booking cannot be cancelled online.</p>'}
            </div>
          </aside>

          <section>
            ${!room.bookable ? `<div class="alert alert-error">${room.fits ? 'Sorry — this room is no longer available for your dates.' : 'This room cannot accommodate your party. Please choose another room or add rooms.'} <a href="#/hotel/${h.id}${stayQuery(p)}#rooms">Choose another room</a></div>` : ''}
            ${u ? `<div class="alert alert-info">You're signed in as <strong>${esc(u.email)}</strong>. This booking will be saved to your account.</div>`
                : `<div class="alert alert-info"><a href="#/login?next=${encodeURIComponent(currentPath())}">Sign in</a> to book with your saved details, or continue as a guest.</div>`}
            <form class="card card-pad" id="book-form" novalidate>
              <h2>Enter your details</h2>
              <div class="form-grid">
                <div class="form-field"><label for="bk-first">First name *</label><input id="bk-first" required maxlength="60" value="${esc(first || '')}" autocomplete="given-name" /></div>
                <div class="form-field"><label for="bk-last">Last name *</label><input id="bk-last" required maxlength="60" value="${esc(rest.join(' '))}" autocomplete="family-name" /></div>
                <div class="form-field full"><label for="bk-email">Email address *</label><input id="bk-email" type="email" required maxlength="120" value="${esc(u?.email || '')}" autocomplete="email" /><div class="hint">Your confirmation will be linked to this email address.</div></div>
                <div class="form-field full"><label for="bk-phone">Phone number</label><input id="bk-phone" type="tel" maxlength="30" autocomplete="tel" placeholder="+49 30 1234567" /><div class="hint">So the property can reach you if needed.</div></div>
                <div class="form-field full"><label for="bk-req">Special requests</label><textarea id="bk-req" rows="3" maxlength="1000" placeholder="E.g. a quiet room, late arrival, extra pillows…"></textarea><div class="hint">Special requests cannot be guaranteed but the property will do its best.</div></div>
              </div>
              <div id="bk-error"></div>
              <label style="display:flex;gap:8px;align-items:flex-start;margin:14px 0" class="small"><input type="checkbox" id="bk-terms" style="width:18px;height:18px" /> I agree to the booking conditions and understand this is a demo — no payment is taken.</label>
              <button class="btn btn-primary btn-lg btn-block" type="submit" ${room.bookable ? '' : 'disabled'}>Complete booking</button>
            </form>
          </section>
        </div>
      </div>`;

    $('#book-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $('#bk-error');
      errEl.innerHTML = '';
      const body = {
        hotelId: Number(p.hotel), roomTypeId: Number(p.room), checkIn: data.stay.checkIn, checkOut: data.stay.checkOut,
        guests: data.guests, rooms: data.rooms,
        firstName: $('#bk-first').value.trim(), lastName: $('#bk-last').value.trim(), email: $('#bk-email').value.trim(),
        phone: $('#bk-phone').value.trim(), specialRequests: $('#bk-req').value.trim(),
      };
      if (!body.firstName || !body.lastName) { errEl.innerHTML = errorBox('Please enter the first and last name of the main guest.'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) { errEl.innerHTML = errorBox('Please enter a valid email address.'); return; }
      if (!$('#bk-terms').checked) { errEl.innerHTML = errorBox('Please accept the booking conditions.'); return; }
      const btn = e.submitter || $('#book-form button[type=submit]');
      btn.disabled = true; btn.textContent = 'Booking…';
      try {
        const { booking } = await api('POST', '/bookings', body);
        sessionStorage.setItem('hs_booking_email_' + booking.reference, booking.email);
        navigate('/confirmation/' + booking.reference);
      } catch (err) {
        errEl.innerHTML = errorBox(err.message);
        btn.disabled = false; btn.textContent = 'Complete booking';
      }
    });
  }

  // ---------------------------------------------------------------------

  function bookingStatus(b) {
    if (b.status === 'cancelled') return ['cancelled', 'Cancelled'];
    if (b.checkOut <= today()) return ['completed', 'Completed'];
    return ['confirmed', 'Confirmed'];
  }

  async function viewConfirmation(ref) {
    app.innerHTML = `<div class="container">${loader()}</div>`;
    const email = sessionStorage.getItem('hs_booking_email_' + ref) || '';
    try {
      const { booking: b } = await api('GET', `/bookings/${encodeURIComponent(ref)}${qs({ email })}`);
      app.innerHTML = `
        <div class="container" style="max-width:820px">
          ${stepsHtml(3)}
          <div class="confirm-hero"><span class="emoji">✅</span><div><h2 style="margin:0">Your booking in ${esc(b.city)} is confirmed.</h2><div>We've reserved your room at <strong>${esc(b.hotelName)}</strong>.</div></div></div>
          ${bookingDetailHtml(b)}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
            ${state.user ? '<a class="btn btn-primary" href="#/bookings">Go to my bookings</a>' : '<a class="btn btn-primary" href="#/manage">Manage this booking</a>'}
            <button class="btn btn-outline" type="button" onclick="window.print()">🖨 Print confirmation</button>
            <a class="btn btn-outline" href="#/">Book another stay</a>
          </div>
        </div>`;
    } catch (err) {
      app.innerHTML = `<div class="container section">${errorBox(err.message)}<p>You can look up your booking on the <a href="#/manage">Find my booking</a> page.</p></div>`;
    }
  }

  function bookingDetailHtml(b) {
    const [cls, label] = bookingStatus(b);
    const nights = nightsBetween(b.checkIn, b.checkOut);
    return `
      <div class="card">
        <div class="card-pad" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><div class="small muted">Booking reference</div><div style="font-size:22px;font-weight:800;letter-spacing:1px">${esc(b.reference)}</div></div>
          <div style="text-align:right"><span class="status status-${cls}">${label}</span></div>
          <div><div class="small muted">Check-in</div><strong>${fmtDate(b.checkIn)}</strong></div>
          <div><div class="small muted">Check-out</div><strong>${fmtDate(b.checkOut)}</strong></div>
          <div><div class="small muted">Property</div><a href="#/hotel/${b.hotelId}"><strong>${esc(b.hotelName)}</strong></a><div class="small">${esc(b.address)}</div></div>
          <div><div class="small muted">Room</div><strong>${b.rooms > 1 ? b.rooms + ' × ' : ''}${esc(b.roomName)}</strong><div class="small">${esc(b.beds)} · ${plural(b.guests, 'guest')} · ${plural(nights, 'night')}</div></div>
          <div><div class="small muted">Main guest</div><strong>${esc(b.firstName)} ${esc(b.lastName)}</strong><div class="small">${esc(b.email)}${b.phone ? ' · ' + esc(b.phone) : ''}</div></div>
          <div><div class="small muted">Total price</div><div class="price-big">${fmtMoney(b.totalPrice)}</div><div class="small muted">Pay at the property</div></div>
          ${b.specialRequests ? `<div style="grid-column:1/-1"><div class="small muted">Special requests</div>${esc(b.specialRequests)}</div>` : ''}
          <div style="grid-column:1/-1" class="small ${b.freeCancellation ? 'green' : ''}">${b.freeCancellation ? '✓ Free cancellation before ' + fmtDate(b.checkIn) : 'Non-refundable booking'}</div>
        </div>
      </div>`;
  }

  async function cancelFlow(ref, email) {
    if (!confirm(`Cancel booking ${ref}? This cannot be undone.`)) return false;
    try {
      await api('POST', `/bookings/${encodeURIComponent(ref)}/cancel`, email ? { email } : {});
      toast('Your booking has been cancelled.');
      return true;
    } catch (err) { toast(err.message); return false; }
  }

  async function viewBookings() {
    if (!state.user) { navigate('/login?next=' + encodeURIComponent('/bookings')); return; }
    app.innerHTML = `<div class="container section"><h1>Bookings &amp; trips</h1><div id="bk-list">${loader()}</div></div>`;
    try {
      const { bookings } = await api('GET', '/bookings');
      const list = $('#bk-list');
      if (!bookings.length) {
        list.innerHTML = `<div class="empty card"><div class="emoji">🧳</div><h3>Where to next?</h3><p class="muted">You haven't made any bookings yet. Once you do, they'll appear here.</p><a class="btn btn-primary" href="#/">Start searching</a></div>`;
        return;
      }
      const upcoming = bookings.filter((b) => bookingStatus(b)[0] === 'confirmed').sort((a, b) => a.checkIn.localeCompare(b.checkIn));
      const past = bookings.filter((b) => bookingStatus(b)[0] !== 'confirmed');
      const item = (b) => {
        const [cls, label] = bookingStatus(b);
        return `
          <div class="card booking-item">
            <img src="${esc(b.image)}" alt="${esc(b.hotelName)}" loading="lazy" />
            <div>
              <a href="#/hotel/${b.hotelId}"><strong style="font-size:16px">${esc(b.hotelName)}</strong></a> <span class="status status-${cls}">${label}</span>
              <div class="small muted">${esc(b.city)}, ${esc(b.country)}</div>
              <div>${fmtDate(b.checkIn, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmtDate(b.checkOut, { day: 'numeric', month: 'short', year: 'numeric' })} · ${b.rooms > 1 ? b.rooms + ' × ' : ''}${esc(b.roomName)}</div>
              <div class="small muted">Reference ${esc(b.reference)} · ${plural(b.guests, 'guest')}</div>
            </div>
            <div style="text-align:right;display:flex;flex-direction:column;gap:6px;align-items:flex-end">
              <div class="price-big" style="font-size:18px">${fmtMoney(b.totalPrice)}</div>
              ${b.canCancel ? `<button class="btn btn-danger" data-cancel="${esc(b.reference)}">Cancel booking</button>` : ''}
              ${b.status === 'confirmed' ? `<a class="small" href="#/hotel/${b.hotelId}#reviews">Write a review</a>` : ''}
              <a class="small" href="#/hotel/${b.hotelId}">Book again</a>
            </div>
          </div>`;
      };
      list.innerHTML = `
        <h2>Upcoming</h2>${upcoming.length ? upcoming.map(item).join('') : '<p class="muted">No upcoming trips.</p>'}
        ${past.length ? `<h2 style="margin-top:24px">Past &amp; cancelled</h2>${past.map(item).join('')}` : ''}`;
      $$('button[data-cancel]', list).forEach((btn) => btn.addEventListener('click', async () => {
        if (await cancelFlow(btn.dataset.cancel)) viewBookings();
      }));
    } catch (err) {
      $('#bk-list').innerHTML = errorBox(err.message);
    }
  }

  function viewManage(params) {
    const ref = params.get('ref') || '';
    app.innerHTML = `
      <div class="container" style="max-width:820px">
        <div class="section">
          <h1>Find my booking</h1>
          <p class="muted">Enter your booking reference and the email address used to book.</p>
          <form class="card card-pad" id="lookup-form">
            <div class="form-grid">
              <div class="form-field"><label for="lk-ref">Booking reference</label><input id="lk-ref" required placeholder="HSXXXXXXXX" value="${esc(ref)}" style="text-transform:uppercase" /></div>
              <div class="form-field"><label for="lk-email">Email address</label><input id="lk-email" type="email" required /></div>
            </div>
            <button class="btn btn-primary" type="submit" style="margin-top:12px">Find booking</button>
          </form>
          <div id="lookup-result" style="margin-top:16px"></div>
        </div>
      </div>`;
    async function lookup() {
      const r = $('#lk-ref').value.trim().toUpperCase(), em = $('#lk-email').value.trim();
      const out = $('#lookup-result');
      out.innerHTML = loader();
      try {
        const { booking: b } = await api('GET', `/bookings/${encodeURIComponent(r)}${qs({ email: em })}`);
        out.innerHTML = bookingDetailHtml(b) + (b.canCancel ? '<button class="btn btn-danger" id="lk-cancel" style="margin-top:12px">Cancel this booking</button>' : '');
        const c = $('#lk-cancel');
        if (c) c.addEventListener('click', async () => { if (await cancelFlow(r, em)) lookup(); });
      } catch (err) { out.innerHTML = errorBox(err.message); }
    }
    $('#lookup-form').addEventListener('submit', (e) => { e.preventDefault(); lookup(); });
  }

  async function viewWishlist() {
    if (!state.user) {
      app.innerHTML = `<div class="container section"><div class="empty card"><div class="emoji">♥</div><h3>Save properties you love</h3><p class="muted">Sign in to create your saved list and access it from any device.</p><a class="btn btn-primary" href="#/login?next=%2Fwishlist">Sign in</a></div></div>`;
      return;
    }
    app.innerHTML = `<div class="container section"><h1>My saved properties</h1><div id="wl">${loader()}</div></div>`;
    try {
      const { hotels } = await api('GET', '/wishlist');
      const el = $('#wl');
      if (!hotels.length) {
        el.innerHTML = `<div class="empty card"><div class="emoji">♡</div><h3>Your list is empty</h3><p class="muted">Tap the heart on any property to save it here.</p><a class="btn btn-primary" href="#/">Explore properties</a></div>`;
        return;
      }
      const s = state.lastSearch;
      el.innerHTML = hotels.map((h) => hotelCardHtml(
        { ...h, cheapestRoom: { name: h.propertyType, beds: h.address }, roomsLeft: 99 },
        { stay: null }, s)).join('');
      // Removing from this page should remove the card.
      $$('.heart', el).forEach((b) => b.addEventListener('click', () => setTimeout(() => {
        if (!b.classList.contains('saved')) b.closest('.hotel-card').remove();
      }, 400)));
    } catch (err) { $('#wl').innerHTML = errorBox(err.message); }
  }

  // ---------------------------------------------------------------------

  function safeNext(params) {
    const next = params.get('next') || '/';
    // Only allow in-app paths, and never bounce back to the auth pages.
    if (!next.startsWith('/') || next.startsWith('//') || /^\/(login|register)/.test(next)) return '/';
    return next;
  }

  function viewAuth(mode, params) {
    if (state.user) { navigate(safeNext(params)); return; }
    const isLogin = mode === 'login';
    const nextQ = params.get('next') ? '?next=' + encodeURIComponent(params.get('next')) : '';
    app.innerHTML = `
      <div class="container">
        <div class="auth-box card card-pad">
          <h1 style="font-size:24px">${isLogin ? 'Sign in to HotelSucher' : 'Create your account'}</h1>
          <p class="muted">${isLogin ? 'Manage your bookings and saved properties.' : 'Save properties, manage trips and leave reviews.'}</p>
          <form id="auth-form" novalidate>
            ${isLogin ? '' : '<div class="form-field" style="margin-bottom:12px"><label for="au-name">Full name</label><input id="au-name" required maxlength="80" autocomplete="name" /></div>'}
            <div class="form-field" style="margin-bottom:12px"><label for="au-email">Email address</label><input id="au-email" type="email" required autocomplete="email" /></div>
            <div class="form-field" style="margin-bottom:12px"><label for="au-pass">Password</label><input id="au-pass" type="password" required minlength="8" autocomplete="${isLogin ? 'current-password' : 'new-password'}" />${isLogin ? '' : '<div class="hint">At least 8 characters.</div>'}</div>
            <div id="au-error"></div>
            <button class="btn btn-primary btn-block btn-lg" type="submit">${isLogin ? 'Sign in' : 'Create account'}</button>
          </form>
          <p class="small" style="margin-top:14px;text-align:center">${isLogin
            ? `New to HotelSucher? <a href="#/register${nextQ}">Create an account</a>`
            : `Already have an account? <a href="#/login${nextQ}">Sign in</a>`}</p>
        </div>
      </div>`;
    $('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { email: $('#au-email').value.trim(), password: $('#au-pass').value };
      if (!isLogin) body.name = $('#au-name').value.trim();
      const errEl = $('#au-error');
      errEl.innerHTML = '';
      if (!isLogin && !body.name) { errEl.innerHTML = errorBox('Please enter your name.'); return; }
      if (!body.email || !body.password) { errEl.innerHTML = errorBox('Please enter your email and password.'); return; }
      if (!isLogin && body.password.length < 8) { errEl.innerHTML = errorBox('Password must be at least 8 characters.'); return; }
      try {
        const { user } = await api('POST', isLogin ? '/auth/login' : '/auth/register', body);
        state.user = user;
        renderHeader();
        toast(isLogin ? `Welcome back, ${user.name.split(' ')[0]}!` : `Welcome to HotelSucher, ${user.name.split(' ')[0]}!`);
        navigate(safeNext(params));
      } catch (err) { errEl.innerHTML = errorBox(err.message); }
    });
  }

  function viewHelp() {
    const faq = [
      ['How do I book a stay?', 'Search for a destination, pick your dates and number of guests, open a property and click “Reserve” on the room you like. Enter your details and confirm — that\'s it.'],
      ['Do I need an account?', 'No. You can book as a guest and manage the reservation with your booking reference and email. With an account you also get a trip overview, saved properties and the ability to write reviews.'],
      ['How do I cancel?', 'Open “My bookings” (signed in) or “Find my booking” (guest). Bookings with free cancellation can be cancelled online any time before the check-in date. Non-refundable bookings cannot be cancelled online.'],
      ['When do I pay?', 'HotelSucher is a demo: no payment is ever taken. In a real deployment you would pay at the property.'],
      ['Who can write reviews?', 'Only signed-in guests who booked a property can review it, once per property — so every review comes from a real booking.'],
    ];
    app.innerHTML = `
      <div class="container section" style="max-width:820px">
        <h1>Help centre</h1>
        ${faq.map(([q, a]) => `<details class="card card-pad" style="margin-bottom:10px"><summary><strong>${esc(q)}</strong></summary><p style="margin-bottom:0">${esc(a)}</p></details>`).join('')}
      </div>`;
  }

  function viewNotFound() {
    app.innerHTML = `<div class="container section"><div class="empty card"><div class="emoji">🧭</div><h2>Page not found</h2><p class="muted">The page you're looking for doesn't exist.</p><a class="btn btn-primary" href="#/">Go home</a></div></div>`;
  }

  // ======================================================================
  // Router
  // ======================================================================

  let lastRoute = '';
  async function route() {
    let hash = location.hash.slice(1) || '/';
    // Support in-page anchors like "#rooms": if hash isn't a route, scroll to the element.
    if (!hash.startsWith('/')) {
      const el = document.getElementById(hash);
      if (el) { el.scrollIntoView({ behavior: 'smooth' }); history.replaceState(null, '', '#' + lastRoute); return; }
      hash = '/';
    }
    // Allow "/hotel/1?x=y#rooms" style anchors.
    let anchor = '';
    const hashIdx = hash.indexOf('#');
    if (hashIdx >= 0) { anchor = hash.slice(hashIdx + 1); hash = hash.slice(0, hashIdx); }
    const [path, query = ''] = hash.split('?');
    const params = new URLSearchParams(query);
    const parts = path.split('/').filter(Boolean);
    const samePage = lastRoute.split('?')[0] === path;
    lastRoute = hash;

    $$('.header-tabs .tab').forEach((t) => {
      const target = t.getAttribute('href').slice(1);
      t.classList.toggle('active', target === '/' ? ['', 'search', 'hotel', 'book'].includes(parts[0] || '') : path.startsWith(target));
    });

    const scrollY = window.scrollY;
    switch (parts[0]) {
      case undefined: await viewHome(); break;
      case 'search': await viewSearch(params); break;
      case 'hotel': await viewHotel(parts[1], params); break;
      case 'book': await viewBook(params); break;
      case 'confirmation': await viewConfirmation(parts[1]); break;
      case 'bookings': await viewBookings(); break;
      case 'manage': viewManage(params); break;
      case 'wishlist': await viewWishlist(); break;
      case 'login': viewAuth('login', params); break;
      case 'register': viewAuth('register', params); break;
      case 'help': viewHelp(); break;
      default: viewNotFound();
    }
    if (anchor) {
      const el = document.getElementById(anchor);
      if (el) el.scrollIntoView();
    } else if (samePage && parts[0] === 'search') {
      window.scrollTo(0, scrollY); // keep position while filtering
    } else {
      window.scrollTo(0, 0);
    }
    if (!state.user || ['login', 'register'].includes(parts[0])) renderHeader(); // keep "next" links current
  }

  window.addEventListener('hashchange', route);
  $('#year').textContent = new Date().getFullYear();
  refreshUser().then(route);
})();
