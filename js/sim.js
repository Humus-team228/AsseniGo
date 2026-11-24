// Эмулятор датчиков: бак и GPS меняются сами, водитель ничего не вводит руками.
// Запускается на любой странице и останавливается при закрытии вкладки.
import { getDrivers, getOrders, getTariffs, saveDriverSensors, updateDriver, updateTariffs } from './api.js';

const TICK_MS = 2000;
const FAST_TICK_MS = 500;
const DRAIN_MS = 20000;
const DRAIN_LEVEL = 10;
const TANK_STEP = 25;
const EN_ROUTE_STEP = 0.2;
// Шаг поворота вокруг центра: машина едет по кругу, радиус не меняется.
const TURN_STEP = 0.04;
const ACTIVE_STATUSES = new Set(['assigned', 'accepted', 'en_route', 'on_site']);

// ДОПУЩЕНИЕ: центр карты и симуляции — Воронеж (PLAN.md, вопрос Q-01).
const CENTER = { lat: 51.6608, lng: 39.2003 };
const BOUNDS = { minLat: 51.55, maxLat: 51.78, minLng: 39.05, maxLng: 39.35 };

let timer = null;
let tickMs = TICK_MS;
let busy = false;
// Заказы, которые эмулятор видел в работе: нужно, чтобы начислить +25 % бака.
const activeOrdersSeen = new Set();

export function startSimulation() {
  if (timer) return;
  runTick();
  timer = window.setInterval(runTick, tickMs);
  window.addEventListener('beforeunload', stopSimulation);
  if (isDevMode()) buildDevPanel();
}

export function stopSimulation() {
  if (timer) {
    window.clearInterval(timer);
    timer = null;
  }
  window.removeEventListener('beforeunload', stopSimulation);
}

async function runTick() {
  if (busy) return;
  busy = true;
  try {
    const [drivers, orders] = await Promise.all([getDrivers(), getOrders()]);
    orders.forEach((order) => {
      if (ACTIVE_STATUSES.has(order.status)) activeOrdersSeen.add(order.id);
    });

    const now = Date.now();
    const patches = drivers.map((driver) => buildPatch(driver, orders, now));
    await saveDriverSensors(patches);
  } catch {
    // Сбой датчика не должен ломать экран: следующий тик попробует снова.
  } finally {
    busy = false;
  }
}

// Собирает изменения датчиков одной машины: бак и координаты.
function buildPatch(driver, orders, now) {
  const patch = {};
  let tank = clamp(readNumber(driver.tankPct), 0, 100);

  // 1. Откачка: за выполненный заказ бак прибавляет 25 % (один раз на заказ).
  const tankOrder = findTankOrder(driver, orders);
  if (tankOrder && driver.tankFilledOrderId !== tankOrder.id && tank < 100) {
    tank = Math.min(100, tank + TANK_STEP);
    patch.tankPct = tank;
    patch.tankFilledOrderId = tankOrder.id;
  }

  // 2. Полный бак: 20 секунд «на слив», затем бак падает до 10 %.
  if (driver.drainingUntil) {
    if (now >= readNumber(driver.drainingUntil)) {
      patch.tankPct = DRAIN_LEVEL;
      patch.drainingUntil = null;
    }
  } else if (tank >= 100) {
    patch.drainingUntil = now + DRAIN_MS / speedFactor();
  }

  // 3. GPS: машина двигается сама, координаты водитель не вводит.
  const point = nextPoint(driver, orders);
  if (point) {
    patch.lat = point.lat;
    patch.lng = point.lng;
  }
  return { id: driver.id, ...patch };
}

function findTankOrder(driver, orders) {
  const own = orders.filter((order) => order.driverId === driver.id);
  const onSite = own.find((order) => order.status === 'on_site');
  if (onSite) return onSite;
  return own.find((order) => order.status === 'completed' && activeOrdersSeen.has(order.id)) || null;
}

function nextPoint(driver, orders) {
  const lat = Number(driver.lat);
  const lng = Number(driver.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const order = orders.find((item) => item.driverId === driver.id
    && (item.status === 'en_route' || item.status === 'on_site'));
  const targetLat = order ? Number(order.lat) : NaN;
  const targetLng = order ? Number(order.lng) : NaN;

  if (order && Number.isFinite(targetLat) && Number.isFinite(targetLng)) {
    // Едем по прямой к адресу клиента; на объекте останавливаемся в точке.
    const step = order.status === 'on_site' ? 1 : EN_ROUTE_STEP;
    return normalize(lat + (targetLat - lat) * step, lng + (targetLng - lng) * step);
  }

  if (driver.status === 'free') return moveAroundCenter(lat, lng);
  return null;
}

// Поворачивает точку вокруг центра на TURN_STEP — получается круг.
function moveAroundCenter(lat, lng) {
  const cosLat = Math.cos(toRadians(CENTER.lat));
  const dx = (lng - CENTER.lng) * cosLat;
  const dy = lat - CENTER.lat;
  const cosStep = Math.cos(TURN_STEP);
  const sinStep = Math.sin(TURN_STEP);
  const x = dx * cosStep - dy * sinStep;
  const y = dx * sinStep + dy * cosStep;

  return normalize(CENTER.lat + y, CENTER.lng + x / cosLat);
}

function normalize(lat, lng) {
  return {
    lat: round6(clamp(lat, BOUNDS.minLat, BOUNDS.maxLat)),
    lng: round6(clamp(lng, BOUNDS.minLng, BOUNDS.maxLng)),
  };
}

// ---------- Демо-панель ?dev=1 ----------

function isDevMode() {
  return new URLSearchParams(window.location.search).has('dev');
}

function buildDevPanel() {
  if (document.getElementById('dev-panel')) return;
  const panel = document.createElement('aside');
  panel.id = 'dev-panel';
  panel.className = 'dev-panel';
  panel.setAttribute('aria-label', 'Демо-панель симулятора');
  panel.innerHTML = `
    <div class="dev-panel__head">
      <strong>Демо-панель</strong>
      <button type="button" class="dev-panel__close" data-dev="close" aria-label="Скрыть демо-панель">✕</button>
    </div>
    <label class="dev-panel__row">Погода
      <select id="dev-weather">
        <option value="clear">Ясно</option>
        <option value="rain">Дождь</option>
        <option value="snow">Снег</option>
        <option value="frost">Мороз</option>
      </select>
    </label>
    <label class="dev-panel__row">Машина
      <select id="dev-driver"></select>
    </label>
    <button type="button" class="btn btn--ghost dev-panel__btn" data-dev="fill">Заполнить бак</button>
    <label class="dev-panel__check">
      <input type="checkbox" id="dev-fast"> Ускорить симуляцию
    </label>
  `;
  document.body.append(panel);

  panel.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-dev]')?.dataset.dev;
    if (action === 'close') {
      panel.remove();
      return;
    }
    if (action !== 'fill') return;

    try {
      const select = panel.querySelector('#dev-driver');
      if (select.value) await updateDriver(select.value, { tankPct: 100 });
    } catch {
      // Панель демонстрационная: при ошибке просто ждём следующей попытки.
    }
  });

  const weather = panel.querySelector('#dev-weather');
  weather.addEventListener('change', () => {
    // Погода влияет на цену в следующем этапе; сейчас сохраняем выбор.
    updateTariffs({ weather: weather.value }).catch(() => {});
  });

  panel.querySelector('#dev-fast').addEventListener('change', (event) => {
    tickMs = event.target.checked ? FAST_TICK_MS : TICK_MS;
    restartTimer();
  });

  loadDevData(weather, panel.querySelector('#dev-driver'));
}

function restartTimer() {
  if (!timer) return;
  window.clearInterval(timer);
  timer = window.setInterval(runTick, tickMs);
}

// Ускорение демо-режима: слив тоже становится в 4 раза короче.
function speedFactor() {
  return tickMs === FAST_TICK_MS ? 4 : 1;
}

async function loadDevData(weatherSelect, driverSelect) {
  try {
    const [drivers, tariffs] = await Promise.all([getDrivers(), getTariffs()]);
    if (tariffs && tariffs.weather) weatherSelect.value = tariffs.weather;
    driverSelect.innerHTML = drivers
      .map((driver) => `<option value="${driver.id}">${driver.name} · ${driver.plate}</option>`)
      .join('');
  } catch {
    // Демо-панель не критична для работы сайта.
  }
}

function readNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}
