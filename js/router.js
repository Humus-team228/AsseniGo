// Хэш-роутер: работает на GitHub Pages, где сервер не умеет отдавать SPA-пути.
let routes = [];
let onRoute = null;

export function initRouter(routeList, callback) {
  routes = routeList;
  onRoute = callback;
  window.addEventListener('hashchange', dispatch);
  dispatch();
}

export function navigate(path) {
  const target = path.startsWith('/') ? path : `/${path}`;
  if (window.location.hash === `#${target}`) {
    dispatch();
    return;
  }
  window.location.hash = target;
}

export function getPath() {
  return readPath();
}

export function refreshRoute() {
  dispatch();
}

function readPath() {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function dispatch() {
  if (!onRoute) return;
  const path = readPath();
  const found = matchRoute(path);
  onRoute({
    path,
    route: found ? found.route : null,
    params: found ? found.params : {},
  });
}

function matchRoute(path) {
  for (const route of routes) {
    const params = matchPattern(route.path, path);
    if (params) return { route, params };
  }
  return null;
}

// Поддерживает простые параметры вида "/track/:id".
function matchPattern(pattern, path) {
  const expected = pattern.split('/').filter(Boolean);
  const actual = path.split('/').filter(Boolean);
  if (expected.length !== actual.length) return null;

  const params = {};
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i].startsWith(':')) {
      try {
        params[expected[i].slice(1)] = decodeURIComponent(actual[i]);
      } catch {
        return null;
      }
    } else if (expected[i] !== actual[i]) {
      return null;
    }
  }
  return params;
}
