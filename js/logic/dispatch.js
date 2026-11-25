// Автовыбор машины: чистые функции без DOM и localStorage.
// Оценка = 0.5 · близость + 0.3 · рейтинг/5 + 0.2 · (1 − бак/100).
const EARTH_RADIUS_KM = 6371;
// ДОПУЩЕНИЕ: 30 км — верхняя граница «близости» в пределах города (PLAN.md, §8).
const MAX_DISTANCE_KM = 30;
// Заказ в этих статусах держит машину занятой.
const ACTIVE_STATUSES = new Set(['assigned', 'accepted', 'en_route', 'on_site']);

// Расстояние по формуле гаверсинуса, км.
export function distanceKm(from, to) {
  const lat1 = toRadians(Number(from.lat));
  const lat2 = toRadians(Number(to.lat));
  const dLat = lat2 - lat1;
  const dLng = toRadians(Number(to.lng) - Number(from.lng));
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// order — заказ или черновик с координатами { lat, lng }.
// Возвращает { driverId, reason } или null, если свободных машин нет.
export function pickDriver(order, drivers, orders = []) {
  const orderList = Array.isArray(orders) ? orders : [];
  const busyByOrders = new Set(
    orderList
      .filter((item) => ACTIVE_STATUSES.has(item.status) && item.driverId)
      .map((item) => item.driverId),
  );

  const candidates = (Array.isArray(drivers) ? drivers : [])
    .filter((driver) => isAvailable(driver, busyByOrders));
  if (candidates.length === 0) return null;

  const point = readPoint(order);
  const scored = candidates.map((driver) => scoreDriver(driver, point));
  scored.sort((a, b) => b.score - a.score || a.distance - b.distance);

  const best = scored[0];
  return {
    driverId: best.driver.id,
    reason: {
      distanceKm: point ? round(best.distance, 1) : null,
      tankPct: Math.round(clamp(readNumber(best.driver.tankPct), 0, 100)),
      rating: round(clamp(readNumber(best.driver.rating), 0, 5), 1),
    },
  };
}

// Готовая запись о назначении: её показывают клиент и водитель.
export function buildAssignment(driver, reason) {
  return {
    driverName: driver ? driver.name : '',
    plate: driver ? driver.plate : '',
    phone: driver ? driver.phone : '',
    distanceKm: reason.distanceKm,
    tankPct: reason.tankPct,
    rating: reason.rating,
    at: new Date().toISOString(),
  };
}

function isAvailable(driver, busyByOrders) {
  if (!driver) return false;
  const tank = Number(driver.tankPct);
  return !driver.blocked
    && driver.status === 'free'
    && !busyByOrders.has(driver.id)
    && Number.isFinite(tank)
    && tank < 100
    && Number.isFinite(Number(driver.lat))
    && Number.isFinite(Number(driver.lng));
}

function scoreDriver(driver, point) {
  const distance = point ? distanceKm(point, driver) : MAX_DISTANCE_KM;
  const proximity = point ? Math.max(0, 1 - distance / MAX_DISTANCE_KM) : 0;
  const rating = clamp(readNumber(driver.rating), 0, 5);
  const tank = clamp(readNumber(driver.tankPct), 0, 100);

  return {
    driver,
    distance,
    score: 0.5 * proximity + 0.3 * (rating / 5) + 0.2 * (1 - tank / 100),
  };
}

function readPoint(order) {
  if (!order) return null;
  const lat = Number(order.lat);
  const lng = Number(order.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
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

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
