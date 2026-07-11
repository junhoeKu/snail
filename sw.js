/**
 * Snail 서비스 워커 — 정적 자산 캐시 우선 (오프라인 실행)
 * CACHE_VERSION을 올리면 다음 방문 시 새 캐시로 교체된다.
 */
const CACHE_VERSION = 'snail-v0.9.0';

const PRECACHE = [
  '.',
  'index.html',
  'manifest.json',
  'css/theme.css',
  'css/components.css',
  'css/home.css',
  'css/stats.css',
  'css/shop.css',
  'css/explore.css',
  'css/settings.css',
  'js/db.js',
  'js/game.js',
  'js/toast.js',
  'js/sound.js',
  'js/fx.js',
  'js/stats.js',
  'js/home.js',
  'js/shop.js',
  'js/deco.js',
  'js/explore.js',
  'js/settings.js',
  'js/habitat.js',
  'js/app.js',
  'assets/icon.svg',
  'assets/icon-180.png',
  'assets/icon-512.png',
  'assets/backgrounds/bg_moss.jpg',
  'assets/backgrounds/bg_garden.jpg',
  'assets/characters/egg.png',
  'assets/characters/snail_brown_baby.png',
  'assets/characters/snail_brown_junior.png',
  'assets/characters/snail_brown_adult.png',
  'assets/characters/snail_gray_baby.png',
  'assets/characters/snail_gray_junior.png',
  'assets/characters/snail_gray_adult.png',
  'assets/characters/snail_russet_baby.png',
  'assets/characters/snail_russet_junior.png',
  'assets/characters/snail_russet_adult.png',
  'assets/characters/snail_olive_baby.png',
  'assets/characters/snail_olive_junior.png',
  'assets/characters/snail_olive_adult.png',
  'assets/characters/snail_golden_baby.png',
  'assets/characters/snail_golden_junior.png',
  'assets/characters/snail_golden_adult.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_VERSION) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        // 성공한 응답은 캐시에 복사 (CDN 폰트 등 opaque 포함)
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(function (cache) {
            cache.put(event.request, copy);
          });
        }
        return response;
      });
    })
  );
});
