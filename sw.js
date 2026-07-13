/**
 * Snail 서비스 워커 — 정적 자산 캐시 우선 (오프라인 실행)
 * CACHE_VERSION을 올리면 다음 방문 시 새 캐시로 교체된다.
 */
const CACHE_VERSION = 'snail-v1.5.3';

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
  'js/api.js',
  'js/sound.js',
  'js/fx.js',
  'js/stats.js',
  'js/home.js',
  'js/shop.js',
  'js/deco.js',
  'js/explore.js',
  'js/share.js',
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
  'assets/characters/snail_yellow_baby.png',
  'assets/characters/snail_yellow_junior.png',
  'assets/characters/snail_yellow_adult.png',
  'assets/characters/snail_bluegray_baby.png',
  'assets/characters/snail_bluegray_junior.png',
  'assets/characters/snail_bluegray_adult.png',
  'assets/characters/snail_lavender_baby.png',
  'assets/characters/snail_lavender_junior.png',
  'assets/characters/snail_lavender_adult.png',
  'assets/characters/snail_red_baby.png',
  'assets/characters/snail_red_junior.png',
  'assets/characters/snail_red_adult.png',
  'assets/characters/snail_herb_baby.png',
  'assets/characters/snail_herb_junior.png',
  'assets/characters/snail_herb_adult.png',
  'assets/characters/snail_black_baby.png',
  'assets/characters/snail_black_junior.png',
  'assets/characters/snail_black_adult.png',
  'assets/characters/snail_lime_baby.png',
  'assets/characters/snail_lime_junior.png',
  'assets/characters/snail_lime_adult.png',
  'assets/characters/snail_sky_baby.png',
  'assets/characters/snail_sky_junior.png',
  'assets/characters/snail_sky_adult.png',
  'assets/characters/snail_pond_baby.png',
  'assets/characters/snail_pond_junior.png',
  'assets/characters/snail_pond_adult.png',
  'assets/characters/snail_maple_baby.png',
  'assets/characters/snail_maple_junior.png',
  'assets/characters/snail_maple_adult.png',
  'assets/characters/snail_pinwheel_baby.png',
  'assets/characters/snail_pinwheel_junior.png',
  'assets/characters/snail_pinwheel_adult.png',
  'assets/characters/snail_cherry_baby.png',
  'assets/characters/snail_cherry_junior.png',
  'assets/characters/snail_cherry_adult.png',
  'assets/characters/snail_sunflower_baby.png',
  'assets/characters/snail_sunflower_junior.png',
  'assets/characters/snail_sunflower_adult.png',
  'assets/characters/snail_bee_baby.png',
  'assets/characters/snail_bee_junior.png',
  'assets/characters/snail_bee_adult.png',
  'assets/characters/snail_devil_baby.png',
  'assets/characters/snail_devil_junior.png',
  'assets/characters/snail_devil_adult.png',
  'assets/characters/snail_angel_baby.png',
  'assets/characters/snail_angel_junior.png',
  'assets/characters/snail_angel_adult.png',
  'assets/characters/snail_ladybug_baby.png',
  'assets/characters/snail_ladybug_junior.png',
  'assets/characters/snail_ladybug_adult.png'
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
  // 서버 API는 절대 캐시하지 않는다 — 낡은 게임 상태 응답 방지
  if (event.request.url.indexOf('/v1/') !== -1) return;

  // config.js는 네트워크 우선 (설정 변경이 즉시 반영되도록, 오프라인 시 캐시 폴백)
  if (event.request.url.indexOf('config.js') !== -1) {
    event.respondWith(
      fetch(event.request).then(function (response) {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then(function (cache) { cache.put(event.request, copy); });
        return response;
      }).catch(function () { return caches.match(event.request); })
    );
    return;
  }

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
