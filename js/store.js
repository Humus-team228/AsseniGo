// Состояние приложения.
// Текущий пользователь хранится в sessionStorage: у каждой вкладки своя роль,
// поэтому клиент и водитель могут работать одновременно в двух вкладках.
// Данные (заказы, машины) и черновик — в localStorage, общем для вкладок.
const USER_KEY = 'assenigo:user';
const DRAFT_KEY = 'assenigo:draft';
const DATA_KEYS = new Set(['assenigo:drivers', 'assenigo:orders', 'assenigo:tariffs']);
const listeners = new Set();

let state = { user: readJson(USER_KEY, null, window.sessionStorage) };

export function getUser() {
  return state.user;
}

export function setUser(user) {
  state = { ...state, user };
  writeJson(USER_KEY, user, window.sessionStorage);
  notify({ key: USER_KEY });
}

export function clearUser() {
  state = { ...state, user: null };
  removeItem(USER_KEY, window.sessionStorage);
  notify({ key: USER_KEY });
}

export function getDraft() {
  return readJson(DRAFT_KEY, null, window.localStorage);
}

export function saveDraft(draft) {
  writeJson(DRAFT_KEY, { ...draft, savedAt: new Date().toISOString() }, window.localStorage);
}

export function clearDraft() {
  removeItem(DRAFT_KEY, window.localStorage);
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Изменения данных: из этой же вкладки (custom event) и из других (storage).
export function subscribeData(listener) {
  const onStorage = (event) => {
    if (DATA_KEYS.has(event.key)) notifyData(listener, { key: event.key, source: 'storage' });
  };
  const onLocal = (event) => {
    const key = event.detail && event.detail.key;
    if (DATA_KEYS.has(key)) notifyData(listener, { key, source: 'local' });
  };

  window.addEventListener('storage', onStorage);
  window.addEventListener('assenigo:datachange', onLocal);

  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('assenigo:datachange', onLocal);
  };
}

function notifyData(listener, event) {
  try {
    listener(event);
  } catch (error) {
    console.error('Ошибка подписчика данных', error);
  }
}

function notify(event) {
  listeners.forEach((listener) => {
    try {
      listener(state, event);
    } catch (error) {
      console.error('Ошибка подписчика store', error);
    }
  });
}

function readJson(key, fallback, storage) {
  try {
    const raw = storage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value, storage) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeItem(key, storage) {
  try {
    storage.removeItem(key);
  } catch {
    // Хранилище недоступно — приложение продолжит работу без сохранения.
  }
}
