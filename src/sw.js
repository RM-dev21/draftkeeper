// Service worker: кэширует статику приложения, чтобы после первого открытия
// оно продолжало работать офлайн. Все данные проекта живут в localStorage
// на устройстве — сервис-воркер их не трогает, только раздаёт файлы.
//
// Важно: при любом изменении файлов приложения (app.js/style.css/index.html/...)
// увеличивайте CACHE_VERSION ниже — иначе у уже установивших приложение
// пользователей продолжит отдаваться старая закэшированная версия.
const CACHE_VERSION = 'v22';
const CACHE_NAME = `draftkeeper-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest.json',
  './vendor/diff.min.js',
  './vendor/docx.iife.js',
  './vendor/file-saver.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
  );
});

// Новый воркер остаётся в состоянии "waiting", пока пользователь не нажмёт
// "Обновить" в баннере (app.js шлёт это сообщение) — если активировать его
// сразу (skipWaiting в install), он может перехватить контроль над страницей
// раньше, чем сработает location.reload() после клика, и тогда перезагрузка
// попадёт под старый воркер/кэш, а пользователю покажется, что обновление
// "не подтянулось".
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // Не трогаем запросы к Google Drive/Identity Services и прочие сторонние
  // хосты — им всегда нужна настоящая сеть, кэшировать их бессмысленно и
  // небезопасно (например, ответы OAuth).
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Офлайн и файла нет в кэше: для перехода по страницам отдаём
          // хотя бы главную, чтобы приложение не показывало ошибку браузера.
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
    })
  );
});
