// 통합 테스트 v7: 양육자 레벨 / 먹이 4종 / 개체 팝업 / 유저 탭 / 장식 효과
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = require('path').join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
const consoleErrors = [];
function assert(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.error('  ✗ FAIL: ' + msg); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const localDateKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

const NAMESPACES = {
  'js/db.js': 'DB', 'js/game.js': 'GAME', 'js/toast.js': 'Toast', 'js/api.js': 'Api',
  'js/sound.js': 'Sound', 'js/fx.js': 'FX',
  'js/stats.js': 'StatsModule', 'js/dex.js': 'DexModule', 'js/home.js': 'HomeModule', 'js/shop.js': 'ShopModule',
  'js/deco.js': 'DecoModule', 'js/explore.js': 'ExploreModule', 'js/race.js': 'RaceModule', 'js/quiz.js': 'QuizModule', 'js/share.js': 'ShareModule', 'js/settings.js': 'SettingsModule',
  'js/habitat.js': 'HabitatModule', 'js/app.js': 'App'
};

async function boot(storage, fixedRandom, urlSuffix) {
  const dom = new JSDOM(html, {
    url: 'http://localhost:31111/' + (urlSuffix || ''),
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  if (fixedRandom !== undefined) window.Math.random = () => fixedRandom;
  if (storage) for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
  window.console.error = (...a) => consoleErrors.push(a.join(' '));
  for (const src of [...window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => !s.startsWith('http') && s !== 'config.js')) {
    const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
    try { window.eval(code + '\n;window.' + NAMESPACES[src] + ' = ' + NAMESPACES[src] + ';'); }
    catch (e) { consoleErrors.push(src + ': ' + e.message); }
  }
  if (window.document.readyState === 'loading') {
    await new Promise((r) => window.document.addEventListener('DOMContentLoaded', r));
  }
  return window;
}

const player = (w) => JSON.parse(w.localStorage.getItem('sn_player'));
const snails = (w) => JSON.parse(w.localStorage.getItem('sn_snails'));

function clickSnail(w, entId) {
  const ent = w.HabitatModule.debugState().ents.find(e => !entId || e.id === entId);
  w.document.getElementById('snail-habitat').dispatchEvent(
    new w.MouseEvent('pointerdown', { clientX: ent.x, clientY: ent.y, bubbles: true }));
  return ent;
}

(async function main() {
  // ── [1] 첫 실행 ─────────────────────────────────────────
  console.log('[1] 첫 실행');
  const w = await boot(null, 0.5);
  const doc = w.document;
  assert(!doc.getElementById('egg-view').classList.contains('hidden'), '알 온보딩');
  assert(doc.getElementById('coin-count').textContent === '50', '시작 코인 50');
  assert(player(w).keeper.xp === 5, '접속 XP +5');
  assert(doc.getElementById('wallet-food-emoji').textContent === '🥬', '지갑: 선택 먹이(상추)');

  // ── [2] 부화 (양육자 XP: 부화 15 + 도감 신규 25) ────────
  console.log('[2] 부화');
  doc.getElementById('snail-name-input').value = '달달이';
  doc.getElementById('btn-hatch').click();
  doc.querySelector('#modal-root .btn-wide').click();
  assert(player(w).keeper.xp === 45, '부화+도감 XP → 45: ' + player(w).keeper.xp);
  const badge = doc.querySelector('.snail-badge');
  assert(badge !== null && badge.textContent.indexOf('🍀40') !== -1 && badge.textContent.indexOf('😊80') !== -1,
    '머리 위 배지: ' + (badge ? badge.textContent : 'null'));
  w.HabitatModule.MOTION.EAT_DURATION_MS = 60;
  w.HabitatModule.MOTION.NAP_CHANCE = 0;
  w.Math.random = Math.random.bind(Math);

  // ── [3] 미션 루프 (먹이×2 → 팝업 쓰다듬기 → 탐험) ───────
  console.log('[3] 미션 루프 + 양육자 레벨업');
  doc.getElementById('btn-feed').click();
  await sleep(600);
  assert(doc.getElementById('coin-count').textContent === '52', '먹이 1: 52');
  doc.getElementById('btn-feed').click();
  await sleep(600);
  // 먹이 +2코인 + 미션 +10 + 양육자 Lv2 보상 +60 = 124
  assert(doc.getElementById('coin-count').textContent === '124', '먹이 2 + 미션 + 양육자 Lv2(+60) = 124: ' + doc.getElementById('coin-count').textContent);
  assert(player(w).keeper.level === 2 && player(w).keeper.xp === 4, '양육자 Lv2 (xp 4): ' + JSON.stringify(player(w).keeper));
  assert(doc.getElementById('mission-progress').textContent === '1/3', '미션 1/3');

  // 달팽이 클릭 → 팝업 → 쓰다듬기
  clickSnail(w);
  assert(doc.querySelector('.snail-popup') !== null, '개체 팝업 열림');
  assert(doc.querySelector('.snail-popup h3').textContent === '달달이', '팝업 이름');
  assert(doc.querySelector('.popup-desc') !== null, '성격 문구 표시');
  doc.querySelector('.popup-actions .btn-ghost').click(); // 쓰다듬기
  assert(doc.getElementById('coin-count').textContent === '134', '쓰담 미션 +10 = 134');
  assert(doc.getElementById('mission-progress').textContent === '2/3', '미션 2/3');
  doc.querySelector('.popup-close').click();

  // 탐험 (미니게임 허브 → 탐험, 코인 결과 rng 0.1 → +4)
  doc.querySelector('.tab[data-screen="explore"]').click();
  doc.querySelector('.minigame-card[data-game="explore"]').click(); // 허브에서 탐험 진입
  doc.querySelectorAll('.explore-map-card .btn')[0].click();
  w.Math.random = () => 0.1;
  doc.querySelector('.explore-spot').click();
  w.Math.random = Math.random.bind(Math);
  // 134 + 4 + 탐험미션 10 + 완주 20 = 168
  assert(doc.getElementById('coin-count').textContent === '168', '탐험+완주 = 168: ' + doc.getElementById('coin-count').textContent);
  assert(doc.getElementById('mission-progress').textContent === '3/3', '미션 3/3');
  assert(player(w).keeper.xp === 25, '양육자 xp 25: ' + player(w).keeper.xp);

  // ── [4] 먹이 시트 + 해금 게이트 ─────────────────────────
  console.log('[4] 먹이 시트/해금');
  doc.querySelector('.tab-home').click();
  doc.getElementById('wallet-food').click();
  const rows = doc.querySelectorAll('.food-sheet-row');
  assert(rows.length === 4, '먹이 4종 시트');
  assert(!rows[1].disabled, '당근 해금됨 (양육자 Lv2)');
  assert(rows[2].disabled && rows[2].textContent.indexOf('Lv.4') !== -1, '사과 잠김 (Lv.4)');
  assert(rows[3].disabled, '샐러드 잠김');
  doc.querySelector('#modal-root .btn-ghost.btn-wide').click(); // 닫기

  // ── [5] 상점: 묶음/당근/알 ──────────────────────────────
  console.log('[5] 상점 v3');
  const rich = player(w); rich.coins = 5000;
  w.localStorage.setItem('sn_player', JSON.stringify(rich));
  doc.querySelector('.tab[data-screen="shop"]').click();
  const foodRows = doc.querySelectorAll('#shop-foods .shop-item');
  assert(foodRows.length === 4, '상점 먹이 4종');
  assert(foodRows[2].classList.contains('locked'), '사과 행 잠김 표시');
  foodRows[0].querySelectorAll('.btn')[1].click(); // 상추 ×10 (90)
  assert(player(w).coins === 4910 && player(w).foods.lettuce >= 10, '상추 묶음 -90');
  foodRows[1].querySelectorAll('.btn')[0].click(); // 당근 ×1 (18)
  assert(player(w).coins === 4892 && player(w).foods.carrot === 1, '당근 구매 -18');
  doc.getElementById('btn-buy-egg').click();
  assert(player(w).snail_slots === 2 && snails(w).length === 2, '알 구매 → 슬롯 2');

  // 부화 (몽이)
  doc.querySelector('.tab-home').click();
  doc.querySelector('#snail-layer .egg-item').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  doc.querySelector('.modal-overlay input').value = '몽이';
  w.Math.random = () => 0.5;
  doc.querySelector('.modal-actions .btn-primary').click();
  w.Math.random = Math.random.bind(Math);
  doc.querySelector('#modal-root .btn-wide').click();
  assert(doc.querySelectorAll('#snail-layer .snail-entity').length === 2, '2마리');

  // ── [6] 팝업 먹이주기 (그 아이 근처 드롭) ────────────────
  console.log('[6] 팝업 먹이주기');
  const entMong = w.HabitatModule.debugState().ents.find(e => {
    const rec = snails(w).find(s => s.id === e.id);
    return rec && rec.name === '몽이';
  });
  clickSnail(w, entMong.id);
  doc.querySelector('.popup-actions .btn-primary').click(); // 먹이주기 → 팝업 닫히고 근처 드롭
  assert(doc.querySelectorAll('.food-item').length === 1, '근처 드롭');
  await sleep(700);
  assert(doc.querySelectorAll('.food-item').length === 0, '몽이가 먹음');
  const mong = snails(w).find(s => s.name === '몽이');
  assert(mong.exp === 10 || mong.level > 1, '몽이에게 정산');

  // ── [7] 여행 (팝업 경유) ────────────────────────────────
  console.log('[7] 팝업 여행 보내기');
  const list7 = snails(w);
  const dal = list7.find(s => s.name === '달달이');
  dal.level = 20; dal.stage = 'adult';
  w.localStorage.setItem('sn_snails', JSON.stringify(list7));
  w.HomeModule.render(); // sync
  clickSnail(w, dal.id);
  assert(doc.querySelector('.popup-graduate') !== null, '팝업에 여행 버튼');
  doc.querySelector('.popup-graduate').click();
  doc.querySelector('.modal-actions .btn-primary').click(); // 보내기 확인
  assert(JSON.parse(w.localStorage.getItem('sn_album')).length === 1, '앨범 기록');
  assert(player(w).generation === 2, '세대 2');
  assert(snails(w).some(s => s.stage === 'egg') && snails(w).some(s => s.name === '몽이'), '알 교체 + 몽이 유지');
  doc.querySelector('#modal-root .btn-wide').click();

  // ── [8] 유저 탭 + 도감 탭 ───────────────────────────────
  console.log('[8] 유저 탭 / 도감 탭');
  doc.querySelector('.tab[data-screen="user"]').click();
  assert(doc.getElementById('keeper-level').textContent === String(player(w).keeper.level), '양육자 레벨 표시');
  assert(doc.getElementById('keeper-next').textContent.indexOf('Lv.4') !== -1, '다음 해금 안내(사과): ' + doc.getElementById('keeper-next').textContent);
  assert(doc.querySelectorAll('#album-list .album-card').length === 1, '앨범 표시');
  // 도감 탭 — 등급 섹션(기본/레어/에픽) 분리
  doc.querySelector('.tab[data-screen="dex"]').click();
  assert(doc.querySelectorAll('#dex-sections .dex-section').length === 3, '도감 등급 3섹션: ' + doc.querySelectorAll('#dex-sections .dex-section').length);
  assert(doc.querySelector('#dex-sections .dex-cell') !== null, '도감 셀 렌더');

  // ── [9] 장식 효과 ───────────────────────────────────────
  console.log('[9] 장식 효과');
  const p9 = player(w);
  p9.decorations.owned = ['mossrock', 'pebble'];
  p9.decorations.slots = ['mossrock', 'pebble', null];
  p9.last_seen = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
  w.localStorage.setItem('sn_player', JSON.stringify(p9));
  const mongBefore = snails(w).find(s => s.name === '몽이');
  const w2effects = await boot(Object.fromEntries(
    ['sn_player', 'sn_snails', 'sn_journal', 'sn_album'].map(k => [k, w.localStorage.getItem(k)])
  ), 0.99);
  const mongAfter = JSON.parse(w2effects.localStorage.getItem('sn_snails')).find(s => s.name === '몽이');
  assert(mongAfter.hunger === Math.min(100, mongBefore.hunger + Math.round(35 * 0.9)),
    '이끼 바위: 5시간 배고픔 +32 (기본 +35, 감쇠 7×5): ' + (mongAfter.hunger - mongBefore.hunger));
  const modal9 = w2effects.document.querySelector('.modal-overlay');
  if (modal9) modal9.querySelector('button').click();

  // ── [10] v5 → v6 마이그레이션 ───────────────────────────
  console.log('[10] 마이그레이션');
  const now = new Date();
  const w3 = await boot({
    sn_player: JSON.stringify({
      schema_version: 5, coins: 100, food: 7, last_seen: now.toISOString(),
      last_daily_reward: localDateKey(now), streak: { count: 1, last_date: localDateKey(now) },
      background: 'default', missions: { date: null, feed: 0, pet: 0, explore: 0, bonus_given: false },
      generation: 1, mission_completions: 0, sound_on: true,
      decorations: { owned: [], slots: [null, null, null] }, snail_slots: 1,
      explore: { date: null, searches: 0 }, unlocked_maps: []
    }),
    sn_snails: JSON.stringify([{
      schema_version: 5, id: 'sold1', name: '레거시', level: 5, exp: 0, hunger: 20, happiness: 70,
      stage: 'junior', color: 'olive', personality: 'sleepy', pos: { rx: 0.5, ry: 0.5 },
      created_at: now.toISOString()
    }])
  }, 0.5);
  const p10 = JSON.parse(w3.localStorage.getItem('sn_player'));
  assert(p10.schema_version === 6 && p10.foods.lettuce === 7 && p10.food === undefined, 'food→foods 이전');
  assert(p10.keeper.level === 1, 'keeper 기본값');
  assert(w3.document.getElementById('food-count').textContent === '7', '지갑 상추 7');

  // ── [11] 관리자 ─────────────────────────────────────────
  console.log('[11] 관리자');
  const wa = await boot(null, 0.5, '?admin=1');
  const pa = JSON.parse(wa.localStorage.getItem('sn_player'));
  assert(pa.foods.lettuce === 999 && pa.foods.salad === 999, '전 먹이 999');
  assert(wa.GAME.foodUnlocked(pa, 'salad'), '관리자 먹이 잠금 무시');

  // ── [12] 콘솔 에러 ──────────────────────────────────────
  console.log('[12] 콘솔 에러');
  assert(consoleErrors.length === 0, '콘솔 에러 0개' + (consoleErrors.length ? ' — ' + consoleErrors.join(' | ') : ''));

  console.log(failures === 0 ? '\n✅ 통합 테스트 전체 통과' : '\n❌ 실패 ' + failures + '건');
  process.exit(failures === 0 ? 0 : 1);
})();
