(function () {
  'use strict';

  const STORE_KEY = 'kk-route';
  const state = {
    zone: 'all',
    region: 'all',
    freeOnly: false,
    query: '',
    selected: loadSelected(),
  };

  function loadSelected() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      const ids = new Set(PLACES.map(p => p.id));
      return new Set(raw.filter(id => ids.has(id)));
    } catch { return new Set(); }
  }
  function saveSelected() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify([...state.selected])); } catch {}
  }

  const byId = Object.fromEntries(PLACES.map(p => [p.id, p]));
  const $ = sel => document.querySelector(sel);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function visiblePlaces() {
    const q = state.query.trim().toLowerCase();
    return PLACES.filter(p => {
      if (state.zone !== 'all' && p.zone !== state.zone) return false;
      if (state.region !== 'all' && p.region !== state.region) return false;
      if (state.freeOnly && !p.isFree) return false;
      if (q) {
        const hay = (p.name + ' ' + p.region + ' ' + p.short + ' ' + p.desc).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  const grid = $('#grid');
  const countEl = $('#result-count');

  function cardHTML(p) {
    const inRoute = state.selected.has(p.id);
    const z = ZONES[p.zone];
    return `
      <article class="card reveal" data-zone="${p.zone}" data-id="${p.id}">
        <div class="card__media">
          <img src="${p.image}" alt="${p.name}" loading="lazy" decoding="async" width="1200" height="800">
          <span class="card__zone">${z.icon} ${z.label}</span>
          ${p.isFree ? '<span class="card__free">Бесплатно</span>' : ''}
        </div>
        <div class="card__body">
          <h3 class="card__name">${p.name}</h3>
          <p class="card__region"><span class="pin" aria-hidden="true">◈</span> ${p.region}</p>
          <p class="card__short">${p.short}</p>
          <p class="card__coords">${fmtCoord(p.lat, p.lng)} · ${p.duration}</p>
        </div>
        <div class="card__actions">
          <button class="btn btn--route ${inRoute ? 'is-on' : ''}" data-act="toggle" data-id="${p.id}"
            aria-pressed="${inRoute}">
            ${inRoute ? '✓ В маршруте' : '+ В маршрут'}
          </button>
          <button class="btn btn--ghost" data-act="details" data-id="${p.id}">Подробнее</button>
        </div>
      </article>`;
  }

  function fmtCoord(lat, lng) {
    return `${lat.toFixed(3)}° с.ш., ${lng.toFixed(3)}° в.д.`;
  }

  function renderGrid() {
    const list = visiblePlaces();
    countEl.textContent = list.length === PLACES.length
      ? `${PLACES.length} мест`
      : `${list.length} из ${PLACES.length}`;
    if (list.length === 0) {
      grid.innerHTML = `<p class="empty">Ничего не нашлось. Попробуйте сбросить фильтры или изменить запрос</p>`;
      return;
    }
    grid.innerHTML = list.map(cardHTML).join('');
    if (!reduceMotion) observeReveals();
  }

  const routeListEl = $('#route-list');
  const routeDistEl = $('#route-distance');
  const routeCountEl = $('#route-count');
  const yandexBtn = $('#route-yandex');
  const clearBtn = $('#route-clear');
  let currentOrder = [];

  function selectedPlaces() {
    return PLACES.filter(p => state.selected.has(p.id));
  }

  function refreshRoute() {
    const sel = selectedPlaces();
    const result = buildOptimalRoute(sel);
    currentOrder = result.ordered;

    routeCountEl.textContent = String(sel.length);
    routeDistEl.textContent = sel.length >= 2 ? Math.round(result.distanceKm) : '-';

    if (sel.length === 0) {
      routeListEl.innerHTML = `<li class="route-empty">
        Пока пусто. Добавьте места кнопкой «В маршрут» - порядок объезда рассчитается автоматически по кратчайшему пути
      </li>`;
    } else {
      routeListEl.innerHTML = currentOrder.map((p, i) => {
        const leg = i > 0 ? Math.round(haversineKm(currentOrder[i - 1], p)) : null;
        return `<li class="route-stop" data-zone="${p.zone}">
          ${leg !== null ? `<span class="route-leg">${leg} км</span>` : ''}
          <span class="route-num">${i + 1}</span>
          <span class="route-stop__name">${p.name}</span>
          <span class="route-stop__region">${p.region}</span>
          <button class="route-remove" data-act="toggle" data-id="${p.id}" aria-label="Убрать ${p.name} из маршрута">✕</button>
        </li>`;
      }).join('');
    }

    yandexBtn.classList.toggle('is-disabled', sel.length < 1);
    yandexBtn.href = sel.length ? yandexRouteUrl(currentOrder) : '#';
    clearBtn.disabled = sel.length === 0;

    drawMap(currentOrder);
    document.querySelectorAll('.btn--route').forEach(b => {
      const on = state.selected.has(b.dataset.id);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? '✓ В маршруте' : '+ В маршрут';
    });
  }

  function togglePlace(id) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    saveSelected();
    refreshRoute();
  }

  let map, view, dotsLayer, routeLineSource, routeMarkerSource, hoverTip, hoverOverlay;
  let routeActive = false;
  const ZONE_COLORS = { mountains: '#B0742B', water: '#1F7A83', plants: '#3E7A46' };
  const MAP_CENTER = [38.4, 44.9];
  const MAP_ZOOM = 7;
  const toXY = p => ol.proj.fromLonLat([p.lng, p.lat]);

  function dotStyle() {
    const fill = routeActive ? 'rgba(169,183,159,.15)' : 'rgba(169,183,159,.5)';
    const stroke = routeActive ? 'rgba(125,139,116,.35)' : 'rgba(125,139,116,1)';
    return new ol.style.Style({
      image: new ol.style.Circle({
        radius: 4,
        fill: new ol.style.Fill({ color: fill }),
        stroke: new ol.style.Stroke({ color: stroke, width: 1 }),
      }),
    });
  }

  const routeLineStyle = new ol.style.Style({
    stroke: new ol.style.Stroke({ color: 'rgba(46,93,57,.85)', width: 3, lineDash: [2, 7], lineCap: 'round' }),
  });

  function markerStyle(feature) {
    return new ol.style.Style({
      image: new ol.style.Circle({
        radius: 15,
        fill: new ol.style.Fill({ color: ZONE_COLORS[feature.get('zone')] || '#2E5D39' }),
        stroke: new ol.style.Stroke({ color: '#fff', width: 2 }),
      }),
      text: new ol.style.Text({
        text: String(feature.get('num')),
        fill: new ol.style.Fill({ color: '#fff' }),
        font: '700 13px "JetBrains Mono", ui-monospace, monospace',
      }),
    });
  }

  function initMap() {
    view = new ol.View({ center: ol.proj.fromLonLat(MAP_CENTER), zoom: MAP_ZOOM });

    const tiles = new ol.layer.Tile({ source: new ol.source.OSM({ attributions: '© OpenStreetMap' }) });

    const dotsSource = new ol.source.Vector();
    PLACES.forEach(p => dotsSource.addFeature(
      new ol.Feature({ geometry: new ol.geom.Point(toXY(p)), label: p.name })
    ));
    dotsLayer = new ol.layer.Vector({ source: dotsSource, style: dotStyle });

    routeLineSource = new ol.source.Vector();
    const routeLineLayer = new ol.layer.Vector({ source: routeLineSource, style: routeLineStyle });

    routeMarkerSource = new ol.source.Vector();
    const routeMarkerLayer = new ol.layer.Vector({ source: routeMarkerSource, style: markerStyle });

    map = new ol.Map({
      target: 'map',
      layers: [tiles, dotsLayer, routeLineLayer, routeMarkerLayer],
      view,
      controls: ol.control.defaults.defaults(),
      interactions: ol.interaction.defaults.defaults({ mouseWheelZoom: false }),
    });

    map.once('click', () => map.addInteraction(new ol.interaction.MouseWheelZoom()));

    hoverTip = document.createElement('div');
    hoverTip.className = 'map-tip';
    hoverTip.style.display = 'none';
    hoverOverlay = new ol.Overlay({ element: hoverTip, offset: [0, -16], positioning: 'bottom-center', stopEvent: false });
    map.addOverlay(hoverOverlay);
    map.on('pointermove', evt => {
      if (evt.dragging) { hoverTip.style.display = 'none'; return; }
      const f = map.forEachFeatureAtPixel(evt.pixel, x => x, { hitTolerance: 4 });
      const label = f && f.get('label');
      if (label) {
        hoverTip.textContent = label;
        hoverTip.style.display = 'block';
        hoverOverlay.setPosition(evt.coordinate);
      } else {
        hoverTip.style.display = 'none';
      }
      map.getTargetElement().style.cursor = label ? 'pointer' : '';
    });
  }

  function drawMap(ordered) {
    if (!map) return;
    routeLineSource.clear();
    routeMarkerSource.clear();
    routeActive = ordered.length > 0;
    dotsLayer.changed();

    if (ordered.length === 0) {
      view.animate({ center: ol.proj.fromLonLat(MAP_CENTER), zoom: MAP_ZOOM, duration: reduceMotion ? 0 : 300 });
      return;
    }
    const coords = ordered.map(toXY);
    if (ordered.length >= 2) {
      routeLineSource.addFeature(new ol.Feature(new ol.geom.LineString(coords)));
    }
    ordered.forEach((p, i) => routeMarkerSource.addFeature(
      new ol.Feature({ geometry: new ol.geom.Point(coords[i]), num: i + 1, zone: p.zone, label: `${i + 1}. ${p.name}` })
    ));
    view.fit(ol.extent.boundingExtent(coords), { padding: [50, 50, 50, 50], maxZoom: 11, duration: reduceMotion ? 0 : 300 });
  }

  function focusOnMap(id) {
    const p = byId[id];
    if (!p || !map) return;
    $('#planner').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    setTimeout(() => {
      map.updateSize();
      view.animate({ center: toXY(p), zoom: 12, duration: reduceMotion ? 0 : 400 });
    }, reduceMotion ? 0 : 400);
  }

  const dlg = $('#place-dialog');
  const dlgBody = $('#dialog-body');

  function openDetails(id) {
    const p = byId[id];
    if (!p) return;
    const z = ZONES[p.zone];
    const inRoute = state.selected.has(p.id);
    dlgBody.innerHTML = `
      <div class="dlg__media" data-zone="${p.zone}">
        <img src="${p.image}" alt="${p.name}" decoding="async">
        <span class="card__zone">${z.icon} ${z.label}</span>
      </div>
      <div class="dlg__content" data-zone="${p.zone}">
        <p class="eyebrow">${p.region} · ${fmtCoord(p.lat, p.lng)}</p>
        <h2 id="dialog-title">${p.name}</h2>
        <p class="dlg__desc">${p.desc}</p>
        <dl class="dlg__facts">
          <div><dt>Стоимость</dt><dd>${p.cost}</dd></div>
          <div><dt>Время на осмотр</dt><dd>${p.duration}</dd></div>
        </dl>
        <div class="dlg__actions">
          <button class="btn btn--route ${inRoute ? 'is-on' : ''}" data-act="toggle" data-id="${p.id}">
            ${inRoute ? '✓ В маршруте' : '+ В маршрут'}
          </button>
          <button class="btn btn--ghost" data-act="onmap" data-id="${p.id}">Показать на карте</button>
        </div>
        <p class="dlg__credit">Фото: Wikimedia Commons - «${p.source}» · ${p.license}</p>
      </div>`;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }
  function closeDetails() {
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }

  function initTheme() {
    const saved = localStorage.getItem('kk-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(saved || (prefersDark ? 'dark' : 'light'));
    $('#theme-toggle').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      setTheme(next);
      localStorage.setItem('kk-theme', next);
    });
  }
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    const btn = $('#theme-toggle');
    if (btn) { btn.textContent = t === 'dark' ? '☀' : '☾'; btn.setAttribute('aria-label', t === 'dark' ? 'Светлая тема' : 'Тёмная тема'); }
  }

  let io;
  function observeReveals() {
    if (!io) {
      io = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
      }, { rootMargin: '0px 0px -8% 0px' });
    }
    document.querySelectorAll('.reveal:not(.is-in)').forEach(el => io.observe(el));
  }

  function initFilters() {
    $('#zone-filter').addEventListener('click', e => {
      const b = e.target.closest('[data-zone]');
      if (!b) return;
      state.zone = b.dataset.zone;
      document.querySelectorAll('#zone-filter [data-zone]').forEach(x => x.classList.toggle('is-active', x === b));
      renderGrid();
    });
    const rf = $('#region-filter');
    rf.innerHTML = `<option value="all">Все районы</option>` + REGIONS.map(r => `<option value="${r}">${r}</option>`).join('');
    rf.addEventListener('change', () => { state.region = rf.value; renderGrid(); });
    $('#free-filter').addEventListener('change', e => { state.freeOnly = e.target.checked; renderGrid(); });
    
    let t;
    $('#search').addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => { state.query = e.target.value; renderGrid(); }, 120);
    });
  }

  function initEvents() {
    document.body.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.act === 'toggle') togglePlace(id);
      else if (btn.dataset.act === 'details') openDetails(id);
      else if (btn.dataset.act === 'onmap') { closeDetails(); focusOnMap(id); }
    });

    clearBtn.addEventListener('click', () => {
      state.selected.clear(); saveSelected(); refreshRoute();
    });
    yandexBtn.addEventListener('click', e => { if (yandexBtn.classList.contains('is-disabled')) e.preventDefault(); });

    dlg.addEventListener('click', e => {
      if (e.target === dlg) closeDetails();
    });
    $('#dialog-close').addEventListener('click', closeDetails);

    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const t = document.querySelector(a.getAttribute('href'));
        if (t) { e.preventDefault(); t.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); }
      });
    });

    const toTop = $('#to-top');
    if (toTop) {
      const onScroll = () => toTop.classList.toggle('is-visible', window.scrollY > 600);
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
      toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));
    }
  }

  function renderCredits() {
    const el = $('#credits');
    if (!el) return;
    el.innerHTML = PLACES.map(p =>
      `<li><span>${p.name}</span> - «${p.source}», ${p.license}</li>`).join('');
  }

  function init() {
    initTheme();
    initFilters();
    initEvents();
    renderGrid();
    renderCredits();
    initMap();
    refreshRoute();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
