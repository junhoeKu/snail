/**
 * App — 앱 컨트롤러 (부팅/화면 전환/헤더)
 * 전역 네임스페이스: App
 */
const App = (function () {
  'use strict';

  /**
   * 화면 전환
   * @param {string} screen 'home' | 'shop'
   */
  function navigate(screen) {
    document.querySelectorAll('.screen').forEach(function (el) {
      el.classList.toggle('active', el.id === 'screen-' + screen);
    });
    if (screen === 'home' && typeof HomeModule !== 'undefined') HomeModule.render();
    if (screen === 'shop' && typeof ShopModule !== 'undefined') ShopModule.render();
  }

  /** 헤더 지갑(코인/상추) 갱신 */
  function refreshHeader() {
    const player = DB.Player.get();
    document.getElementById('coin-count').textContent = player.coins;
    document.getElementById('food-count').textContent = player.food;
  }

  function _bindNav() {
    document.getElementById('btn-goto-shop').addEventListener('click', function () {
      navigate('shop');
    });
    document.getElementById('btn-back-home').addEventListener('click', function () {
      navigate('home');
    });
  }

  function init() {
    // 첫 실행이면 기본값(알 + 시작 자원)이 생성된다
    DB.Player.get();
    DB.Snail.get();

    _bindNav();
    HomeModule.bind();

    refreshHeader();
    navigate('home');
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    navigate: navigate,
    refreshHeader: refreshHeader
  };
})();
