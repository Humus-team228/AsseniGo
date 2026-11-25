// Слой данных. Сейчас это seed-JSON + localStorage,
// позже те же async-функции можно заменить на запросы к серверу.
const KEYS = {
  services: 'assenigo:services',
  drivers: 'assenigo:drivers',
  clients: 'assenigo:clients',
  orders: 'assenigo:orders',
  tariffs: 'assenigo:tariffs',
};

const SEED_FILES = {
  services: 'services.json',
  drivers: 'drivers.json',
  clients: 'clients.json',
  orders: 'orders.json',
  tariffs: 'tariffs.json',
};

// tankFilledOrderId — внутреннее поле эмулятора: за какой заказ бак уже пополнен.
const SENSOR_FIELDS = ['lat', 'lng', 'tankPct', 'drainingUntil', 'tankFilledOrderId'];

// ДОПУЩЕНИЕ: отдельного admin.json нет в структуре проекта,
// поэтому тестовый админ задан константой.
const ADMIN_PHONE = '+7 900 000-00-99';
const ADMIN_USER = {
  id: 'admin-1',
  role: 'admin',
  name: 'Администратор',
  phone: ADMIN_PHONE,
};

let initPromise = null;

export function initApi() {
  if (!initPromise) initPromise = seedIfNeeded();
  return initPromise;
}

async function seedIfNeeded() {
  const missing = Object.entries(KEYS).filter(([, key]) => read(key, null) === null);
  if (missing.length === 0) return;

  const loaded = await Promise.all(
    missing.map(async ([name, key]) => {
      const response = await fetch(new URL(`../data/${SEED_FILES[name]}`, import.meta.url));
      if (!response.ok) throw new Error(`Не удалось загрузить ${SEED_FILES[name]}`);
      return [key, await response.json()];
    }),
  );

  loaded.forEach(([key, data]) => {
    if (!write(key, data)) {
      throw new Error('Браузер не разрешает сохранить данные в localStorage');
    }
  });
}

export async function getServices() {
  return read(KEYS.services, []);
}

export async function getDrivers() {
  return read(KEYS.drivers, []);
}

export async function getClients() {
  return read(KEYS.clients, []);
}

export async function getTariffs() {
  return read(KEYS.tariffs, null);
}

export async function updateTariffs(patch) {
  const tariffs = await getTariffs();
  if (!tariffs) return null;

  const next = { ...tariffs, ...patch };
  if (!write(KEYS.tariffs, next)) {
    throw new Error('Не удалось сохранить тарифы в localStorage');
  }
  return next;
}

export async function getOrders() {
  return read(KEYS.orders, []);
}

export async function getOrdersByClient(clientId) {
  const orders = await getOrders();
  return orders
    .filter((order) => order.clientId === clientId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getLatestOrderByClient(clientId) {
  const orders = await getOrdersByClient(clientId);
  return orders[0] || null;
}

export async function createOrder(input) {
  const orders = await getOrders();
  const now = new Date().toISOString();
  const assigned = Boolean(input.driverId) && input.status === 'assigned';
  const history = [{ status: 'new', at: now }];
  if (assigned) history.push({ status: 'assigned', at: now });

  const order = {
    id: makeOrderId(),
    clientId: input.clientId,
    driverId: assigned ? input.driverId : null,
    address: String(input.address || '').trim(),
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    volumeM3: Number(input.volumeM3),
    status: assigned ? 'assigned' : 'new',
    assignment: assigned ? input.assignment || null : null,
    price: null,
    priceBreakdown: null,
    discountPct: 0,
    score: null,
    createdAt: now,
    history,
    supportNote: String(input.supportNote || ''),
  };

  orders.unshift(order);
  if (!write(KEYS.orders, orders)) {
    throw new Error('Не удалось сохранить заказ в localStorage');
  }
  return order;
}

export async function updateOrder(orderId, patch) {
  const orders = await getOrders();
  const index = orders.findIndex((order) => order.id === orderId);
  if (index === -1) return null;

  const next = { ...orders[index], ...patch };
  orders[index] = next;
  if (!write(KEYS.orders, orders)) {
    throw new Error('Не удалось обновить заказ в localStorage');
  }
  return next;
}

// Меняет статус и дописывает шаг в историю заказа.
export async function setOrderStatus(orderId, status, patch = {}) {
  const orders = await getOrders();
  const order = orders.find((item) => item.id === orderId);
  if (!order) return null;

  const at = new Date().toISOString();
  return updateOrder(orderId, {
    ...patch,
    status,
    history: [...(Array.isArray(order.history) ? order.history : []), { status, at }],
  });
}

// Ставит машину на заказ, помечает её занятой и пишет шаг в историю.
export async function assignOrder(orderId, driverId, assignment) {
  const order = await setOrderStatus(orderId, 'assigned', {
    driverId,
    assignment: assignment || null,
  });
  if (order && driverId) await updateDriver(driverId, { status: 'busy' });
  return order;
}

export async function updateDriver(driverId, patch) {
  const drivers = await getDrivers();
  const index = drivers.findIndex((driver) => driver.id === driverId);
  if (index === -1) return null;

  const next = { ...drivers[index], ...patch };
  drivers[index] = next;
  if (!write(KEYS.drivers, drivers)) {
    throw new Error('Не удалось обновить водителя в localStorage');
  }
  return next;
}

export async function updateClient(clientId, patch) {
  const clients = await getClients();
  const index = clients.findIndex((client) => client.id === clientId);
  if (index === -1) return null;

  const next = { ...clients[index], ...patch };
  clients[index] = next;
  if (!write(KEYS.clients, clients)) {
    throw new Error('Не удалось обновить клиента в localStorage');
  }
  return next;
}

// Симулятор меняет только датчики, чтобы не затереть действия водителя.
export async function saveDriverSensors(patches) {
  if (!Array.isArray(patches) || patches.length === 0) return false;
  const byId = new Map(patches.map((patch) => [patch.id, patch]));
  const drivers = await getDrivers();
  let changed = false;

  const next = drivers.map((driver) => {
    const patch = byId.get(driver.id);
    if (!patch) return driver;

    const updated = { ...driver };
    SENSOR_FIELDS.forEach((field) => {
      if (patch[field] !== undefined && patch[field] !== driver[field]) {
        updated[field] = patch[field];
        changed = true;
      }
    });
    return updated;
  });

  if (!changed) return false;
  if (!write(KEYS.drivers, next)) {
    throw new Error('Не удалось сохранить данные датчиков');
  }
  return true;
}

export async function findUserByPhone(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  if (digits === normalizePhone(ADMIN_PHONE)) return { ...ADMIN_USER };

  const clients = await getClients();
  const client = clients.find((item) => normalizePhone(item.phone) === digits);
  if (client) {
    return { id: client.id, role: 'client', name: client.name, phone: client.phone };
  }

  const drivers = await getDrivers();
  const driver = drivers.find((item) => normalizePhone(item.phone) === digits);
  if (driver) {
    return { id: driver.id, role: 'driver', name: driver.name, phone: driver.phone };
  }

  return null;
}

export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

function makeOrderId() {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `ord-${stamp}-${random}`;
}

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    // Сообщаем открытым экранам этой же вкладки; другие вкладки получат storage.
    window.dispatchEvent(new CustomEvent('assenigo:datachange', { detail: { key } }));
    return true;
  } catch {
    return false;
  }
}
