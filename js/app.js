/**
 * App — 앱 컨트롤러 (부팅/탭 전환/지갑)
 * 전역 네임스페이스: App
 */
const App = (function () {
  'use strict';

  let _tickTimer = null;
  const TICK_MS = 60 * 1000; // 1분마다 경과 시간 확인

  /**
   * 화면(탭) 전환
   * @param {string} screen 'home' | 'stats' | 'shop' | 'deco' | 'settings'
   */
  function navigate(screen) {
    document.querySelectorAll('.screen').forEach(function (el) {
      el.classList.toggle('active', el.id === 'screen-' + screen);
    });
    document.querySelectorAll('.tab-bar .tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.screen === screen);
    });

    if (screen === 'home' && typeof HomeModule !== 'undefined') HomeModule.render();
    if (screen === 'stats' && typeof StatsModule !== 'undefined') StatsModule.render();
    if (screen === 'shop' && typeof ShopModule !== 'undefined') ShopModule.render();
    if (screen === 'deco' && typeof DecoModule !== 'undefined') DecoModule.render();

    // 홈에서만 서식지 게임 루프를 돌린다
    if (typeof HabitatModule !== 'undefined') {
      if (screen === 'home') HabitatModule.resume();
      else HabitatModule.pause();
    }
  }

  /** 지갑(코인/상추) 표시 갱신 */
  function refreshHeader() {
    const player = DB.Player.get();
    document.getElementById('coin-count').textContent = player.coins;
    document.getElementById('food-count').textContent = player.food;
  }

  /**
   * 경과 시간 정산 (미접속분 포함).
   * 1시간 단위로만 적용되며, 적용된 구간만큼만 last_seen을 전진시켜
   * 1시간 미만의 잔여 시간을 잃지 않는다.
   * @returns {boolean} 감쇠가 적용되었는지
   */
  function _settleTime() {
    const player = DB.Player.get();
    const snail = DB.Snail.get();
    const result = GAME.applyTimeDecay(snail, player.last_seen, DB.now());

    if (result.intervals <= 0) return false;

    DB.Snail.save(result.snail);
    const advancedMs = result.intervals * GAME.CONFIG.DECAY_INTERVAL_MIN * 60 * 1000;
    player.last_seen = new Date(new Date(player.last_seen).getTime() + advancedMs).toISOString();
    DB.Player.save(player);
    return true;
  }

  /** 앱 사용 중에도 시간 감쇠가 반영되도록 주기 확인 */
  function _startTick() {
    if (_tickTimer) clearInterval(_tickTimer);
    _tickTimer = setInterval(function () {
      if (!_settleTime()) return;
      refreshHeader();
      if (document.getElementById('screen-home').classList.contains('active')) {
        HomeModule.render();
      }
      if (document.getElementById('screen-stats').classList.contains('active')) {
        StatsModule.render();
      }
    }, TICK_MS);
  }

  /** 저장된 배경을 body에 적용 */
  function applyBackground() {
    const player = DB.Player.get();
    document.body.dataset.background = player.background || 'default';
  }

  /** 일일 접속 보상 (하루 1회 자동 지급) */
  function _claimDailyReward() {
    const result = GAME.claimDaily(DB.Player.get(), DB.today());
    if (result.events.indexOf('daily_claimed') !== -1) {
      DB.Player.save(result.player);
      Toast.show('🎁 접속 보상 +' + GAME.CONFIG.DAILY_COINS + ' 코인!');
    }
  }

  function _bindNav() {
    document.querySelectorAll('.tab-bar .tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        navigate(tab.dataset.screen);
      });
    });
  }

  function init() {
    // 첫 실행이면 기본값(알 + 시작 자원)이 생성된다
    DB.Player.get();
    DB.Snail.get();

    _bindNav();
    HomeModule.bind();
    ShopModule.bind();
    DecoModule.bind();
    SettingsModule.bind();
    SettingsModule.render();

    _settleTime();
    _claimDailyReward();
    applyBackground();
    refreshHeader();
    navigate('home');
    HabitatModule.init();
    _startTick();
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    navigate: navigate,
    refreshHeader: refreshHeader,
    applyBackground: applyBackground
  };
})();
