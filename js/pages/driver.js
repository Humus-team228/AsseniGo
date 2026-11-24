import * as api from '../api.js';
import { pickDriver, buildAssignment } from '../logic/dispatch.js';
import { applyRefusal } from '../logic/rating.js';
import { getUser, subscribeData } from '../store.js';

const SUPPORT_PHONE = '8 800 000-00-00';
const SUPPORT_TEL = '88000000000';
// Порог блокировки лежит в tariffs.json; здесь только запасное значение для подписи.
const DEFAULT_THRESHOLD = 3.5;
const ACTIVE_STATUSES = ['assigned', 'accepted', 'en_route', 'on_site'];
const STATUS_LABELS = { assigned: 'Назначен', accepted: 'Принят', en_route: 'В пути', on_site: 'На объекте' };
const NEXT_STEP = {
  accepted: { action: 'en_route', label: 'В пути' },
  en_route: { action: 'on_site', label: 'На объекте' },
  on_site: { action: 'complete', label: 'Завершить' },
};
const STATUS_ACTIONS = { accept: 'accepted', en_route: 'en_route', on_site: 'on_site' };

export async function renderDriver(container) {
  const user = getUser();
  const tariffs = await api.getTariffs();
  const threshold = Number(tariffs && tariffs.blockThreshold) || DEFAULT_THRESHOLD;
  let driver = await loadDriver(user.id);
  let orders = await api.getOrders();
  let actionBusy = false;
  let confirmOrderId = null;
  let blockedShown = false;
  let stopped = false;

  if (!driver) {
    container.innerHTML = `
      <section class="empty">
        <h2>Профиль водителя не найден</h2>
        <p>Войдите под тестовым номером водителя: +7 900 000-00-11.</p>
      </section>
    `;
    return;
  }

  mount();
  const unsubscribe = subscribeData(onData);
  container.addEventListener('click', onClick);
  return () => {
    stopped = true;
    unsubscribe();
    container.removeEventListener('click', onClick);
  };

  async function loadDriver(driverId) {
    return (await api.getDrivers()).find((item) => item.id === driverId) || null;
  }

  function mount() {
    blockedShown = Boolean(driver.blocked);
    if (driver.blocked) {
      container.innerHTML = `
        <section class="empty">
          <h2>Аккаунт заблокирован</h2>
          <p>Аккаунт заблокирован. Обратитесь в поддержку:
            <a href="tel:${SUPPORT_TEL}">${SUPPORT_PHONE}</a></p>
          <p class="hint">Разблокировать аккаунт может только оператор.</p>
        </section>
      `;
      return;
    }

    container.innerHTML = `
      <section class="section">
        <h1>Кабинет водителя</h1>
        <p class="hint">Заказы назначает система. Бак и координаты приходят из эмулятора — вручную их не вводят.</p>
        <p class="notice" id="drv-notice" hidden></p>
        <div class="card">
          <dl class="summary">
            <div class="summary__row"><dt>Водитель</dt><dd id="drv-name"></dd></div>
            <div class="summary__row"><dt>Рейтинг</dt><dd><span id="drv-rating"></span> из 5</dd></div>
            <div class="summary__row"><dt>Статус</dt><dd><span class="status-pill" id="drv-status"></span></dd></div>
            <div class="summary__row"><dt>Отказов</dt><dd id="drv-refusals"></dd></div>
          </dl>
        </div>
        <div class="card section">
          <div class="section__head">
            <h2>Датчики машины</h2>
            <span class="demo-badge">Демо: данные датчика — эмуляция</span>
          </div>
          <dl class="summary"><div class="summary__row"><dt>Бак</dt><dd id="drv-tank-value"></dd></div></dl>
          <div class="meter" aria-hidden="true"><span class="meter__fill" id="drv-tank-fill"></span></div>
          <dl class="summary"><div class="summary__row"><dt>Координаты</dt><dd id="drv-coords"></dd></div></dl>
          <p class="hint" id="drv-tank-note"></p>
        </div>
        <section class="section">
          <div class="section__head">
            <h2>Назначенные заказы</h2>
            <p class="section__note">Порог блокировки: ${threshold}</p>
          </div>
          <div class="empty" id="drv-feed-empty" hidden>
            <h2>Пока нет заказов</h2>
            <p>Система назначит машину автоматически — лента обновится сама.</p>
          </div>
          <ul class="driver-feed" id="drv-feed"></ul>
        </section>
      </section>
    `;

    document.getElementById('drv-name').textContent = `${driver.name} · ${driver.plate}`;
    updateVitals();
    renderFeed();
  }

  function updateVitals() {
    const tank = Math.round(Number(driver.tankPct) || 0);
    const full = tank >= 100;
    const busy = driver.status === 'busy';

    setText('drv-rating', Number(driver.rating || 0).toFixed(1));
    setText('drv-refusals', String(Number(driver.refusals) || 0));
    setText('drv-tank-value', `${tank} %`);
    setText('drv-coords', `${Number(driver.lat).toFixed(5)}, ${Number(driver.lng).toFixed(5)}`);
    const pill = document.getElementById('drv-status');
    if (pill) {
      pill.textContent = full ? 'На сливе' : busy ? 'На заказе' : 'Свободен';
      pill.classList.toggle('status-pill--busy', full || busy);
    }
    const fill = document.getElementById('drv-tank-fill');
    if (fill) {
      fill.style.width = `${Math.min(100, tank)}%`;
      fill.classList.toggle('meter__fill--full', full);
    }
    const note = document.getElementById('drv-tank-note');
    if (note) {
      note.textContent = full
        ? 'Бак полон: машина скрыта с карты клиента и не получает заказы, пока эмулятор не сольёт бак до 10 %.'
        : '';
    }
  }

  function renderFeed() {
    const list = document.getElementById('drv-feed');
    const empty = document.getElementById('drv-feed-empty');
    if (!list || !empty) return;

    const own = orders.filter((order) => order.driverId === driver.id
      && ACTIVE_STATUSES.includes(order.status));
    empty.hidden = own.length > 0;
    list.replaceChildren(...own.map(buildOrderCard));
  }

  function buildOrderCard(order) {
    const item = document.createElement('li');
    item.className = 'card order-card';
    const head = document.createElement('div');
    head.className = 'order-card__head';
    const title = document.createElement('h3');
    title.textContent = order.address;
    const chip = document.createElement('span');
    chip.className = 'status-pill';
    chip.textContent = STATUS_LABELS[order.status] || order.status;
    head.append(title, chip);
    const meta = document.createElement('p');
    meta.className = 'order-card__meta';
    meta.textContent = `Заказ ${order.id} · ${order.volumeM3} м³ · оплата наличными водителю`;

    item.append(head, meta, buildActions(order));
    return item;
  }

  function buildActions(order) {
    const box = document.createElement('div');
    box.className = 'order-actions';

    if (order.status === 'assigned' && confirmOrderId === order.id) {
      const text = document.createElement('p');
      text.className = 'order-confirm__text';
      text.textContent = 'Отказаться от заказа? Рейтинг снизится на 0.3, заказ уйдёт другой машине.';
      box.append(text,
        makeButton('Да, отказаться', 'refuse-confirm', order.id, 'btn btn--danger'),
        makeButton('Оставить', 'refuse-cancel', order.id, 'btn btn--ghost'));
      return box;
    }
    if (order.status === 'assigned') {
      box.append(
        makeButton('Принять', 'accept', order.id, 'btn btn--primary'),
        makeButton('Отказаться', 'refuse', order.id, 'btn btn--danger'),
      );
      return box;
    }
    const step = NEXT_STEP[order.status];
    if (step) {
      box.classList.add('order-actions--single');
      box.append(makeButton(step.label, step.action, order.id, 'btn btn--primary'));
    }
    return box;
  }

  function makeButton(label, action, orderId, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    Object.assign(button.dataset, { action, order: orderId });
    button.textContent = label;
    return button;
  }

  async function onClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button || actionBusy) return;
    actionBusy = true;
    button.disabled = true;
    try {
      await runAction(button.dataset.action, button.dataset.order);
    } catch (error) {
      console.error('Ошибка действия водителя', error);
      showNotice('Не удалось сохранить действие. Попробуйте ещё раз.');
    } finally {
      actionBusy = false;
      button.disabled = false;
    }
  }

  async function runAction(action, orderId) {
    if (action === 'refuse' || action === 'refuse-cancel') {
      confirmOrderId = action === 'refuse' ? orderId : null;
      renderFeed();
      return null;
    }
    if (action === 'refuse-confirm') {
      confirmOrderId = null;
      return refuseOrder(orderId);
    }
    if (STATUS_ACTIONS[action]) return api.setOrderStatus(orderId, STATUS_ACTIONS[action]);
    if (action === 'complete') return completeOrder(orderId);
    return null;
  }

  async function completeOrder(orderId) {
    const order = orders.find((item) => item.id === orderId);
    await api.setOrderStatus(orderId, 'completed');
    await api.updateDriver(driver.id, { status: 'free' });
    // Счётчик клиента нужен для скидки на каждый 10-й заказ.
    const clients = order ? await api.getClients() : [];
    const client = order ? clients.find((item) => item.id === order.clientId) : null;
    if (client) {
      await api.updateClient(client.id, {
        completedOrders: (Number(client.completedOrders) || 0) + 1,
      });
    }
  }

  async function refuseOrder(orderId) {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return;

    const penalty = applyRefusal(driver, threshold);
    await api.updateDriver(driver.id, {
      rating: penalty.rating,
      refusals: penalty.refusals,
      blocked: penalty.blocked,
      status: 'free',
    });
    await api.setOrderStatus(orderId, 'rejected');
    // Переназначаем по тому же алгоритму, но без отказавшейся машины.
    const [drivers, freshOrders] = await Promise.all([api.getDrivers(), api.getOrders()]);
    const next = pickDriver(order, drivers.filter((item) => item.id !== driver.id), freshOrders);
    if (!next) {
      await api.setOrderStatus(orderId, 'new', {
        driverId: null,
        supportNote: 'Свободных машин нет, оператор свяжется с вами.',
      });
      return;
    }
    const nextDriver = drivers.find((item) => item.id === next.driverId) || null;
    await api.assignOrder(orderId, next.driverId, buildAssignment(nextDriver, next.reason));
  }

  async function onData(event) {
    if (stopped) return;
    if (event && event.key === 'assenigo:drivers') {
      driver = await loadDriver(user.id);
      if (stopped || !driver) return;
      if (Boolean(driver.blocked) !== blockedShown) mount();
      else updateVitals();
      return;
    }
    if (event && event.key === 'assenigo:orders') {
      orders = await api.getOrders();
      renderFeed();
    }
  }

  function showNotice(message) {
    const notice = document.getElementById('drv-notice');
    if (!notice) return;
    notice.textContent = message;
    notice.hidden = false;
  }
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}
