import * as api from '../api.js';
import { createMap } from '../map.js';
import { getUser, subscribeData } from '../store.js';

const STATUS_LABELS = {
  new: 'Ожидает назначения',
  assigned: 'Машина назначена',
  accepted: 'Водитель принял',
  en_route: 'В пути',
  on_site: 'На объекте',
  completed: 'Выполнен',
  rejected: 'Отказ водителя',
  cancelled: 'Отменён',
  rescheduled: 'Перенесён',
  refunded: 'Возврат',
};

const priceFormatter = new Intl.NumberFormat('ru-RU');

export async function renderHome(container) {
  // ДОПУЩЕНИЕ: город для демо — Москва (PLAN.md, вопрос Q-01).
  const user = getUser();
  const [services, drivers, latestOrder] = await Promise.all([
    api.getServices(),
    api.getDrivers(),
    api.getLatestOrderByClient(user.id),
  ]);

  container.innerHTML = `
    <section class="hero">
      <p class="hero__eyebrow">Москва · откачка септиков и ям</p>
      <h1>Ассенизатор приедет по адресу</h1>
      <p>Укажите адрес и объём — система сама назначит свободную машину. Стоимость увидите до заказа, оплата наличными водителю.</p>
      <a class="btn btn--accent" href="#/order">Вызвать машину</a>
    </section>

    <section class="section" id="latest-order" hidden></section>

    <section class="section">
      <div class="section__head">
        <h2>Машины рядом</h2>
        <p class="section__note" id="cars-note">На карте: <b id="cars-count">0</b></p>
      </div>
      <div class="map-wrap">
        <div id="home-map" class="map"><div class="map-loading">Загружаем карту…</div></div>
      </div>
      <div class="map-legend">
        <span class="legend-item"><span class="legend-dot legend-dot--free"></span>Свободна</span>
        <span class="legend-item"><span class="legend-dot legend-dot--busy"></span>Занята</span>
        <span class="demo-badge">Демо: данные датчика — эмуляция</span>
      </div>
    </section>

    <section class="section">
      <div class="section__head">
        <h2>Услуги и цены</h2>
        <p class="section__note">Цена «от», итог зависит от объёма и расстояния</p>
      </div>
      <ul class="services" id="services-list"></ul>
    </section>
  `;

  renderLatestOrder(latestOrder);
  renderServices(services);

  const visibleCount = drivers.filter((driver) => {
    const tank = Number(driver.tankPct);
    return !driver.blocked && Number.isFinite(tank) && tank < 100;
  }).length;

  const count = document.getElementById('cars-count');
  if (count) count.textContent = String(visibleCount);
  if (visibleCount === 0) {
    const note = document.getElementById('cars-note');
    if (note) note.textContent = 'Свободных машин сейчас нет';
  }

  const mapApi = createMap('home-map', {
    drivers,
    fallbackText: 'Карта недоступна, укажите адрес текстом.',
  });

  // Другая вкладка (водитель, админ) меняет заказ — карточка обновляется сама.
  const unsubscribeData = subscribeData(async (event) => {
    if (event && event.key !== 'assenigo:orders') return;
    const latest = await api.getLatestOrderByClient(user.id);
    renderLatestOrder(latest);
  });

  return () => {
    unsubscribeData();
    if (mapApi) mapApi.destroy();
  };
}

function renderLatestOrder(order) {
  const section = document.getElementById('latest-order');
  if (!section) return;

  if (!order) {
    section.hidden = true;
    section.innerHTML = '';
    return;
  }

  section.hidden = false;
  section.innerHTML = `
    <div class="section__head"><h2>Последний заказ</h2></div>
    <div class="card">
      <p class="order-id"></p>
      <p class="latest-address"></p>
      <p class="hint"></p>
    </div>
  `;

  section.querySelector('.order-id').textContent = `Заказ ${order.id}`;
  section.querySelector('.latest-address').textContent = order.address;
  section.querySelector('.hint').textContent = [
    `${order.volumeM3} м³`,
    STATUS_LABELS[order.status] || order.status,
    order.assignment && order.assignment.driverName
      ? `Водитель: ${order.assignment.driverName}`
      : '',
    formatDate(order.createdAt),
  ].filter(Boolean).join(' · ');
}

function renderServices(services) {
  const list = document.getElementById('services-list');
  if (!list) return;

  if (services.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<h2>Услуги временно недоступны</h2><p>Позвоните в поддержку: 8 800 000-00-00.</p>';
    list.replaceWith(empty);
    return;
  }

  services.forEach((service) => {
    const item = document.createElement('li');
    item.className = 'card service-card';

    const title = document.createElement('h3');
    title.textContent = service.title;

    const description = document.createElement('p');
    description.textContent = service.description;

    const price = document.createElement('span');
    price.className = 'service-card__price';
    price.textContent = formatPrice(service.fromPrice);

    item.append(title, description, price);
    list.append(item);
  });
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Цена по запросу';
  return `от ${priceFormatter.format(number)} ₽`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
