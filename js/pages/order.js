import * as api from '../api.js';
import { pickDriver, buildAssignment } from '../logic/dispatch.js';
import { createMap } from '../map.js';
import { clearDraft, getDraft, getUser, saveDraft } from '../store.js';

const VOLUMES = [2, 4, 6, 8, 10];
const SUPPORT_PHONE = '8 800 000-00-00';
const kmFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
// ДОПУЩЕНИЕ: выбор времени отключён, заказ оформляется только «сейчас»
// (FEATURES.scheduleOrder = false).
const NO_DRIVERS_NOTE = 'Свободных машин нет, оператор свяжется с вами.';

export async function renderOrder(container) {
  const user = getUser();
  const drivers = await api.getDrivers();
  const draft = getDraft();
  const draftBelongsToUser = draft && draft.clientId === user.id;

  const state = {
    address: draftBelongsToUser && typeof draft.address === 'string' ? draft.address : '',
    volumeM3: draftBelongsToUser && VOLUMES.includes(Number(draft.volumeM3)) ? Number(draft.volumeM3) : 4,
    lat: draftBelongsToUser ? readCoord(draft.lat) : null,
    lng: draftBelongsToUser ? readCoord(draft.lng) : null,
  };

  container.innerHTML = `
    <section class="section">
      <h1>Вызов машины</h1>
      <p class="hint">Заказ только на сейчас. Укажите адрес и объём — машину назначит система.</p>
      <div class="success" id="order-success" role="status" tabindex="-1" hidden>
        <h2 id="success-title"></h2>
        <p class="order-id" id="success-id"></p>
        <p id="success-summary"></p>
        <dl class="summary" id="success-reason" hidden>
          <div class="summary__row"><dt>Машина</dt><dd id="reason-car"></dd></div>
          <div class="summary__row"><dt>Расстояние</dt><dd id="reason-distance"></dd></div>
          <div class="summary__row"><dt>Бак</dt><dd id="reason-tank"></dd></div>
          <div class="summary__row"><dt>Рейтинг</dt><dd id="reason-rating"></dd></div>
        </dl>
        <p class="hint" id="success-note"></p>
        <p class="hint">Оплата: наличными водителю.</p>
        <a class="btn btn--ghost" href="#/">На главную</a>
      </div>
      <div class="map-wrap">
        <div id="order-map" class="map map--order"><div class="map-loading">Загружаем карту…</div></div>
      </div>
      <div class="map-legend">
        <span class="legend-item"><span class="legend-dot legend-dot--free"></span>Свободна</span>
        <span class="legend-item"><span class="legend-dot legend-dot--busy"></span>Занята</span>
        <span class="demo-badge">Демо: данные датчика — эмуляция</span>
      </div>
      <div class="order-layout">
        <form class="card" id="order-form" novalidate>
          <div class="field">
            <label class="label" for="address">Адрес</label>
            <input class="input" id="address" name="address" type="text" autocomplete="street-address"
              placeholder="Улица, дом, посёлок или СНТ" required>
            <p class="hint">Город, улица, дом. Можно добавить ориентир для водителя.</p>
          </div>
          <fieldset class="field">
            <legend class="label">Объём, м³</legend>
            <div class="chips" id="volume-chips"></div>
          </fieldset>
          <div class="field">
            <p class="label">Точка на карте</p>
            <p class="hint" id="point-hint">Нажмите на карту, чтобы поставить точку. Так водитель быстрее найдёт адрес.</p>
            <p class="hint" id="point-value">Точка не выбрана</p>
          </div>
          <p class="form-error" id="order-error" role="alert"></p>
          <button class="btn btn--primary btn--block" id="submit-order" type="submit">Оформить заказ</button>
          <div class="support-note">
            Отмена и споры — только по телефону поддержки:
            <a href="tel:88000000000">${SUPPORT_PHONE}</a>
          </div>
        </form>
        <aside class="card">
          <h2>Проверка заказа</h2>
          <dl class="summary">
            <div class="summary__row"><dt>Адрес</dt><dd id="preview-address">—</dd></div>
            <div class="summary__row"><dt>Объём</dt><dd id="preview-volume">4 м³</dd></div>
            <div class="summary__row"><dt>Когда</dt><dd>Сейчас</dd></div>
            <div class="summary__row"><dt>Машина</dt><dd>Назначит система</dd></div>
            <div class="summary__row"><dt>Оплата</dt><dd>Наличными водителю</dd></div>
          </dl>
          <div class="price-slot">
            <span>Стоимость</span>
            <strong>— ₽</strong>
            <p class="hint">Расчёт цены появится здесь на следующем этапе. Сейчас заказ сохраняется без стоимости.</p>
          </div>
        </aside>
      </div>
    </section>
  `;

  const addressInput = document.getElementById('address');
  const errorBox = document.getElementById('order-error');
  const submitButton = document.getElementById('submit-order');
  const successBox = document.getElementById('order-success');
  const pointValue = document.getElementById('point-value');
  const pointHint = document.getElementById('point-hint');

  addressInput.value = state.address;
  buildVolumeChips();
  updatePreview();
  updatePoint();

  const mapApi = createMap('order-map', {
    drivers,
    point: state.lat !== null && state.lng !== null ? { lat: state.lat, lng: state.lng } : null,
    onPick: (lat, lng) => {
      state.lat = Number(lat.toFixed(6));
      state.lng = Number(lng.toFixed(6));
      updatePoint();
      persistDraft();
      setError('');
    },
    onFallback: () => markMapFallback(),
  });

  if (mapApi && mapApi.isFallback()) markMapFallback();

  addressInput.addEventListener('input', () => {
    state.address = addressInput.value;
    updatePreview();
    persistDraft();
    setError('');
  });

  document.getElementById('order-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitButton.disabled) return;
    setError('');

    const address = state.address.trim();
    if (address.length < 5) {
      setError('Укажите адрес: улицу, дом и населённый пункт.');
      addressInput.focus();
      return;
    }
    const mapWorks = mapApi && !mapApi.isFallback();
    // ДОПУЩЕНИЕ: при рабочей карте точка обязательна, при сбое карты хватит адреса текстом.
    if (mapWorks && (state.lat === null || state.lng === null)) {
      setError('Поставьте точку на карте — так водитель быстрее найдёт адрес.');
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Подбираем машину…';
    successBox.hidden = true;

    try {
      const order = await submitOrder(address);
      clearDraft();
      resetForm();
      showSuccess(order);
    } catch (error) {
      console.error('Не удалось оформить заказ', error);
      setError('Не удалось сохранить заказ. Проверьте настройки браузера и попробуйте ещё раз.');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Оформить заказ';
    }
  });

  return () => {
    if (mapApi) mapApi.destroy();
  };

  // Автовыбор: клиент машину не выбирает, её назначает pickDriver.
  async function submitOrder(address) {
    const [freshDrivers, orders] = await Promise.all([api.getDrivers(), api.getOrders()]);
    const choice = pickDriver(
      { address, lat: state.lat, lng: state.lng, volumeM3: state.volumeM3 },
      freshDrivers,
      orders,
    );
    const driver = choice ? freshDrivers.find((item) => item.id === choice.driverId) || null : null;
    const assignment = choice ? buildAssignment(driver, choice.reason) : null;

    const order = await api.createOrder({
      clientId: user.id,
      address,
      lat: state.lat,
      lng: state.lng,
      volumeM3: state.volumeM3,
      driverId: choice ? choice.driverId : null,
      status: choice ? 'assigned' : 'new',
      assignment,
      supportNote: choice ? '' : NO_DRIVERS_NOTE,
    });
    if (choice) await api.updateDriver(choice.driverId, { status: 'busy' });
    return order;
  }

  function buildVolumeChips() {
    const wrap = document.getElementById('volume-chips');
    wrap.innerHTML = VOLUMES
      .map((volume) => `<button type="button" class="chip" data-volume="${volume}">${volume} м³</button>`)
      .join('');

    wrap.addEventListener('click', (event) => {
      const chip = event.target.closest('.chip');
      if (!chip) return;
      state.volumeM3 = Number(chip.dataset.volume);
      syncChips();
      updatePreview();
      persistDraft();
      setError('');
    });
    syncChips();
  }

  function syncChips() {
    document.querySelectorAll('#volume-chips .chip').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(Number(chip.dataset.volume) === state.volumeM3));
    });
  }

  function updatePreview() {
    document.getElementById('preview-address').textContent = state.address.trim() || '—';
    document.getElementById('preview-volume').textContent = `${state.volumeM3} м³`;
  }

  function updatePoint() {
    pointValue.textContent = state.lat === null || state.lng === null
      ? 'Точка не выбрана'
      : `${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}`;
  }

  function persistDraft() {
    saveDraft({
      clientId: user.id,
      address: state.address,
      volumeM3: state.volumeM3,
      lat: state.lat,
      lng: state.lng,
    });
  }

  function resetForm() {
    state.address = '';
    state.volumeM3 = 4;
    state.lat = null;
    state.lng = null;
    addressInput.value = '';
    syncChips();
    updatePreview();
    updatePoint();
    if (mapApi) mapApi.clearPoint();
  }

  function showSuccess(order) {
    const assigned = Boolean(order.driverId);
    const assignment = order.assignment || null;

    document.getElementById('success-title').textContent = assigned
      ? 'Машину назначила система'
      : 'Свободных машин нет';
    document.getElementById('success-id').textContent = `Заказ ${order.id}`;
    document.getElementById('success-summary').textContent = `${order.address} · ${order.volumeM3} м³`;
    document.getElementById('success-note').textContent = assigned
      ? 'Выбрать или поменять машину нельзя: её назначает система по расстоянию, рейтингу и уровню бака.'
      : `${NO_DRIVERS_NOTE} Отмена и споры — по телефону поддержки: ${SUPPORT_PHONE}.`;

    const reason = document.getElementById('success-reason');
    reason.hidden = !assigned;
    if (assigned && assignment) {
      document.getElementById('reason-car').textContent = `${assignment.driverName} · ${assignment.plate} · ${assignment.phone}`;
      document.getElementById('reason-distance').textContent = formatDistance(assignment.distanceKm);
      document.getElementById('reason-tank').textContent = `${assignment.tankPct} %`;
      document.getElementById('reason-rating').textContent = `${Number(assignment.rating).toFixed(1)} из 5`;
    }

    successBox.hidden = false;
    successBox.focus({ preventScroll: true });
    successBox.scrollIntoView({ block: 'nearest' });
  }

  function setError(message) {
    errorBox.textContent = message;
  }

  function markMapFallback() {
    pointHint.textContent = 'Карта недоступна — укажите адрес текстом, оператор уточнит точку.';
    pointValue.textContent = '';
  }
}

function formatDistance(km) {
  if (km === null || km === undefined) return 'адрес без точки на карте';
  return `${kmFormatter.format(km)} км`;
}

function readCoord(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
