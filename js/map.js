// Единственная точка входа для карты.
// Чтобы сменить провайдера (например, на Яндекс), достаточно переписать этот файл.
// ДОПУЩЕНИЕ: город для seed-данных и центра карты — Москва (PLAN.md, вопрос Q-01).
const CITY_CENTER = [55.7558, 37.6173];
const DEFAULT_ZOOM = 11;
const FALLBACK_AFTER_MS = 7000;
const MAX_TILE_ERRORS = 4;

export function createMap(containerId, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  const state = {
    map: null,
    driversLayer: null,
    pointMarker: null,
    fallback: false,
    tileTimer: null,
    onResize: null,
  };

  const api = {
    setDrivers,
    setPoint,
    clearPoint,
    isFallback: () => state.fallback,
    destroy,
  };

  start();
  return api;

  function start() {
    container.classList.add('map');
    if (!window.L) {
      showFallback('Карта недоступна, укажите адрес текстом.');
      return;
    }

    try {
      initLeaflet();
    } catch {
      showFallback('Карта недоступна, укажите адрес текстом.');
    }
  }

  function initLeaflet() {
    container.innerHTML = '';
    const map = window.L.map(container, {
      scrollWheelZoom: false,
      zoomControl: true,
    }).setView(options.center || CITY_CENTER, options.zoom || DEFAULT_ZOOM);
    state.map = map;

    const tiles = window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });

    let tilesLoaded = false;
    let tileErrors = 0;

    tiles.on('tileload', () => {
      tilesLoaded = true;
    });
    tiles.on('tileerror', () => {
      tileErrors += 1;
      if (!tilesLoaded && tileErrors >= MAX_TILE_ERRORS) {
        showFallback('Карта недоступна, укажите адрес текстом.');
      }
    });
    tiles.addTo(map);

    state.tileTimer = window.setTimeout(() => {
      if (!tilesLoaded) showFallback('Карта недоступна, укажите адрес текстом.');
    }, FALLBACK_AFTER_MS);

    state.driversLayer = window.L.layerGroup().addTo(map);
    if (Array.isArray(options.drivers)) setDrivers(options.drivers);
    if (options.point) setPoint(options.point.lat, options.point.lng);

    if (typeof options.onPick === 'function') {
      map.on('click', (event) => {
        setPoint(event.latlng.lat, event.latlng.lng);
        options.onPick(event.latlng.lat, event.latlng.lng);
      });
    }

    state.onResize = () => {
      if (state.map) state.map.invalidateSize();
    };
    window.addEventListener('resize', state.onResize);
  }

  function setDrivers(drivers) {
    if (state.fallback || !state.driversLayer) return;
    state.driversLayer.clearLayers();

    drivers
      .filter((driver) => {
        const tank = Number(driver.tankPct);
        return !driver.blocked && Number.isFinite(tank) && tank < 100;
      })
      .forEach((driver) => {
        if (!Number.isFinite(Number(driver.lat)) || !Number.isFinite(Number(driver.lng))) return;

        const status = driver.status === 'busy' ? 'busy' : 'free';
        const icon = window.L.divIcon({
          className: 'car-icon',
          html: `<span class="car-icon__dot car-icon__dot--${status}" aria-hidden="true">🚛</span>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });

        const marker = window.L.marker([Number(driver.lat), Number(driver.lng)], {
          icon,
          title: driver.name,
        });
        marker.bindTooltip(buildTooltip(driver), { direction: 'top', offset: [0, -14] });
        marker.addTo(state.driversLayer);
      });
  }

  function setPoint(lat, lng) {
    const point = [Number(lat), Number(lng)];
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;

    if (state.fallback || !state.map) return;
    if (state.pointMarker) state.pointMarker.remove();

    const icon = window.L.divIcon({
      className: 'point-icon',
      html: '<span></span>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    state.pointMarker = window.L.marker(point, { icon, keyboard: false }).addTo(state.map);
  }

  function clearPoint() {
    if (state.pointMarker) {
      state.pointMarker.remove();
      state.pointMarker = null;
    }
  }

  function showFallback(message) {
    if (state.fallback) return;
    state.fallback = true;

    if (state.tileTimer) {
      window.clearTimeout(state.tileTimer);
      state.tileTimer = null;
    }
    if (state.onResize) {
      window.removeEventListener('resize', state.onResize);
      state.onResize = null;
    }
    if (state.map) {
      state.map.remove();
      state.map = null;
    }
    state.driversLayer = null;
    state.pointMarker = null;

    container.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'map-fallback';

    const scheme = document.createElement('div');
    scheme.className = 'map-fallback__scheme';
    scheme.setAttribute('aria-hidden', 'true');

    const text = document.createElement('p');
    text.className = 'map-fallback__text';
    text.textContent = message || 'Карта недоступна, укажите адрес текстом.';

    box.append(scheme, text);
    container.append(box);

    if (typeof options.onFallback === 'function') {
      try {
        options.onFallback();
      } catch (error) {
        console.error('Ошибка обработчика недоступной карты', error);
      }
    }
  }

  function destroy() {
    if (state.tileTimer) {
      window.clearTimeout(state.tileTimer);
      state.tileTimer = null;
    }
    if (state.onResize) {
      window.removeEventListener('resize', state.onResize);
      state.onResize = null;
    }
    if (state.map) {
      state.map.remove();
      state.map = null;
    }
    state.driversLayer = null;
    state.pointMarker = null;
  }
}

function buildTooltip(driver) {
  const box = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = driver.name;

  const info = document.createElement('span');
  const rating = Number(driver.rating);
  const tank = Number(driver.tankPct);
  info.textContent = `Рейтинг: ${Number.isFinite(rating) ? rating.toFixed(1) : '—'} · Бак: ${Number.isFinite(tank) ? Math.round(tank) : '—'}%`;

  const demo = document.createElement('span');
  demo.className = 'demo-badge';
  demo.textContent = 'Демо: данные датчика — эмуляция';

  box.append(name, info, document.createElement('br'), demo);
  return box;
}
