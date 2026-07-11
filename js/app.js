/**
 * App — 앱 컨트롤러 (부팅/화면 전환)
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

  function _bindNav() {
    document.getElementById('btn-goto-shop').addEventListener('click', function () {
      navigate('shop');
    });
    document.getElementById('btn-back-home').addEventListener('click', function () {
      navigate('home');
    });
  }

  function init() {
    _bindNav();
    navigate('home');
  }

  document.addEventListener('DOMContentLoaded', init);

  return { navigate: navigate };
})();
