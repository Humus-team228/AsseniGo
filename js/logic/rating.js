// Рейтинг водителя и скидка клиента: чистые функции без DOM и localStorage.
// ДОПУЩЕНИЕ: порог блокировки 3.5 лежит в tariffs.json (blockThreshold).
export const START_RATING = 5;
export const REFUSAL_PENALTY = 0.3;
export const UNBLOCK_RATING = 4;

// Отказ водителя: −0.3 к рейтингу и проверка порога блокировки.
export function applyRefusal(driver, threshold) {
  const rating = round(clamp(readNumber(driver.rating, START_RATING) - REFUSAL_PENALTY, 0, 5), 1);
  return {
    rating,
    refusals: readNumber(driver.refusals, 0) + 1,
    blocked: isBelowThreshold(rating, threshold),
  };
}

// Оценка клиента 1–5 пересчитывает средний балл водителя.
export function applyClientScore(driver, score, threshold) {
  const value = clamp(readNumber(score, 0), 1, 5);
  const count = Math.max(0, readNumber(driver.ratingsCount, 0));
  const current = readNumber(driver.rating, START_RATING);
  const rating = round((current * count + value) / (count + 1), 2);

  return {
    rating,
    ratingsCount: count + 1,
    blocked: isBelowThreshold(rating, threshold),
  };
}

// После разблокировки админом водитель начинает с рейтинга 4.0.
export function unblockDriver() {
  return { blocked: false, rating: UNBLOCK_RATING };
}

export function isBlocked(driver, threshold) {
  return Boolean(driver.blocked)
    || isBelowThreshold(readNumber(driver.rating, START_RATING), threshold);
}

// Скидка 5 % на каждый 10-й завершённый заказ клиента, суммарно не выше 5 %.
export function calcDiscountPct(completedOrders, tariffs) {
  const count = readNumber(completedOrders, 0);
  const every = readNumber(tariffs && tariffs.discountEvery, 10);
  const max = readNumber(tariffs && tariffs.discountPct, 5);
  if (count <= 0 || every <= 0 || count % every !== 0) return 0;
  return Math.min(max, 5);
}

function isBelowThreshold(rating, threshold) {
  const min = Number(threshold);
  return Number.isFinite(min) && rating < min;
}

function readNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
