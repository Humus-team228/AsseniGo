import { initApi, findUserByPhone, normalizePhone } from './api.js';
import { initRouter, navigate, getPath, refreshRoute } from './router.js';
import { clearUser, getUser, setUser, subscribe } from './store.js';
import { renderHome } from './pages/home.js';
import { renderOrder } from './pages/order.js';
import { renderDriver } from './pages/driver.js';
import { startSimulation } from './sim.js';

const ROLE_HOME = { client: '/', driver: '/driver', admin: '/admin' };
const ROLE_LABEL = { client: 'Клиент', driver: 'Водитель', admin: 'Админ' };

const NAV_ITEMS = {
  client: [
    { href: '#/', label: 'Главная', icon: '⌂' },
    { href: '#/order', label: 'Заказ', icon: '＋' },
  ],
  driver: [{ href: '#/driver', label: 'Кабинет', icon: '⌂' }],
  admin: [{ href: '#/admin', label: 'Админка', icon: '⌂' }],
};

const DEMO_ACCOUNTS = [
  { role: 'client', title: 'Клиент', phone: '+7 900 000-00-01' },
  { role: 'driver', title: 'Водитель', phone: '+7 900 000-00-11' },
  { role: 'admin', title: 'Админ', phone: '+7 900 000-00-99' },
];

const routes = [
  { path: '/', roles: ['client'], render: renderHome },
  { path: '/order', roles: ['client'], render: renderOrder },
  { path: '/driver', roles: ['driver'], render: renderDriver },
  {
    path: '/admin',
    roles: ['admin'],
    render: roleStub('Админ-панель', 'Админ-панель появится в следующей версии прототипа.'),
  },
];

const app = document.getElementById('app');
let pageCleanup = null;
let renderToken = 0;

async function boot() {
  try {
    await initApi();
  } catch (error) {
    renderFatal(error);
    return;
  }

  startSimulation();
  subscribe(handleStoreChange);
  initRouter(routes, handleRoute);
}

async function handleRoute({ path, route, params }) {
  const user = getUser();

  if (user && !ROLE_HOME[user.role]) {
    clearUser();
    return;
  }

  if (!user) {
    if (path !== '/login') {
      navigate('/login');
      return;
    }
    renderLoginPage();
    return;
  }

  if (path === '/login') {
    navigate(ROLE_HOME[user.role]);
    return;
  }

  if (!route) {
    renderNotFound(user);
    return;
  }

  if (route.roles && !route.roles.includes(user.role)) {
    navigate(ROLE_HOME[user.role]);
    return;
  }

  renderShell(user);
  await renderPage(route, params, path);
}

function handleStoreChange(state, event) {
  // Данные (заказы, машины) обновляют сами экраны через subscribeData.
  if (event && event.key !== 'assenigo:user') return;

  const user = getUser();
  const path = getPath();

  if (!user) {
    if (path !== '/login') navigate('/login');
    else renderLoginPage();
    return;
  }

  if (path === '/login') {
    navigate(ROLE_HOME[user.role]);
    return;
  }

  refreshRoute();
}

function renderShell(user) {
  cleanupPage();

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="#${ROLE_HOME[user.role]}">Ассени<span>Go</span></a>
        <nav class="mainnav" aria-label="Основная навигация">
          ${(NAV_ITEMS[user.role] || []).map((item) => `
            <a href="${item.href}">
              <span class="nav-icon" aria-hidden="true">${item.icon}</span>${item.label}
            </a>
          `).join('')}
        </nav>
        <div class="topbar__user">
          <span class="role-badge">${ROLE_LABEL[user.role] || 'Гость'}</span>
          <span class="topbar__name" id="user-name"></span>
          <button type="button" class="logout" id="logout">Выйти</button>
        </div>
      </header>
      <main class="page" id="page" tabindex="-1"></main>
    </div>
  `;

  document.getElementById('user-name').textContent = user.name;
  document.getElementById('logout').addEventListener('click', clearUser);
}

async function renderPage(route, params, path) {
  const page = document.getElementById('page');
  if (!page) return;

  markActiveNav(path);
  page.innerHTML = '<div class="skeleton">Загружаем экран…</div>';

  const token = ++renderToken;
  try {
    const cleanup = await route.render(page, params);
    if (token !== renderToken) {
      if (typeof cleanup === 'function') cleanup();
      return;
    }
    pageCleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (error) {
    if (token !== renderToken) return;
    console.error('Ошибка экрана', error);
    page.innerHTML = '';
    renderEmpty(page, 'Не удалось загрузить экран', 'Обновите страницу или попробуйте ещё раз.');
  }
}

function renderLoginPage() {
  cleanupPage();
  renderToken += 1;

  app.innerHTML = `
    <main class="login">
      <section class="login__card">
        <p class="login__brand">Ассени<span>Go</span></p>
        <h1>Вход по телефону</h1>
        <p class="login__lead">Без пароля и СМС. Роль определится по номеру из тестовых данных.</p>

        <form id="login-form" novalidate>
          <div class="field">
            <label class="label" for="phone">Номер телефона</label>
            <input class="input" id="phone" name="phone" type="tel" inputmode="tel"
              autocomplete="tel" placeholder="+7 900 000-00-01" required>
          </div>
          <p class="form-error" id="login-error" role="alert"></p>
          <button class="btn btn--primary btn--block" id="login-submit" type="submit">Войти</button>
        </form>

        <div class="section">
          <p class="label">Тестовые номера</p>
          <p class="hint">Нажмите на номер, чтобы войти без ввода.</p>
          <ul class="demo-list">
            ${DEMO_ACCOUNTS.map((account) => `
              <li>
                <button type="button" class="demo-btn" data-phone="${account.phone}">
                  <b>${account.title}</b>
                  <span>${account.phone}</span>
                </button>
              </li>
            `).join('')}
          </ul>
        </div>
      </section>
    </main>
  `;

  const form = document.getElementById('login-form');
  const phoneInput = document.getElementById('phone');
  const errorBox = document.getElementById('login-error');
  const submitButton = document.getElementById('login-submit');

  document.querySelectorAll('.demo-btn').forEach((button) => {
    button.addEventListener('click', () => {
      phoneInput.value = button.dataset.phone;
      form.requestSubmit();
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.textContent = '';

    const phone = phoneInput.value.trim();
    if (normalizePhone(phone).length !== 11) {
      errorBox.textContent = 'Введите номер из 11 цифр, например +7 900 000-00-01.';
      phoneInput.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Проверяем…';

    try {
      const user = await findUserByPhone(phone);
      if (!user) {
        errorBox.textContent = 'Номер не найден. Возьмите тестовый номер из списка ниже.';
        phoneInput.focus();
        return;
      }
      setUser(user);
    } catch {
      errorBox.textContent = 'Не удалось проверить номер. Попробуйте ещё раз.';
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Войти';
    }
  });
}

function renderNotFound(user) {
  renderShell(user);
  markActiveNav(getPath());
  const page = document.getElementById('page');
  renderEmpty(page, 'Страница не найдена', 'Проверьте адрес или вернитесь на главную.', true);
}

function renderEmpty(container, title, text, withHomeLink = false) {
  container.innerHTML = `
    <section class="empty">
      <h2></h2>
      <p></p>
      ${withHomeLink ? '<p><a class="btn btn--ghost" href="#/">На главную</a></p>' : ''}
    </section>
  `;
  container.querySelector('h2').textContent = title;
  container.querySelector('p').textContent = text;
}

function roleStub(title, text) {
  return async (container) => {
    renderEmpty(container, title, text);
  };
}

function markActiveNav(path) {
  document.querySelectorAll('.mainnav a').forEach((link) => {
    const href = link.getAttribute('href').replace(/^#/, '');
    if (href === path) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function cleanupPage() {
  renderToken += 1;
  if (typeof pageCleanup === 'function') {
    try {
      pageCleanup();
    } catch (error) {
      console.error('Ошибка очистки экрана', error);
    }
    pageCleanup = null;
  }
}

function renderFatal(error) {
  app.innerHTML = `
    <main class="fatal">
      <h1>Не удалось загрузить данные</h1>
      <p id="fatal-text"></p>
      <p class="hint">Откройте сайт через локальный сервер, например <code>npx serve .</code>,
        а не двойным кликом по файлу index.html.</p>
    </main>
  `;
  document.getElementById('fatal-text').textContent =
    error instanceof Error ? error.message : 'Неизвестная ошибка.';
}

boot();
