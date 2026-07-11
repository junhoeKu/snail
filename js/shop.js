/**
 * ShopModule — 상점 (상추 구매 / 배경 교체)
 * 전역 네임스페이스: ShopModule
 */
const ShopModule = (function () {
  'use strict';

  function render() {
    const player = DB.Player.get();
    document.getElementById('shop-coins').textContent = player.coins;

    document.querySelectorAll('.bg-option').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.bg === player.background);
    });
  }

  function _buyFood() {
    const result = GAME.buyFood(DB.Player.get());

    if (result.events.indexOf('food_bought') !== -1) {
      DB.Player.save(result.player);
      Toast.show('🥬 상추를 구매했어요! (-' + GAME.CONFIG.FOOD_PRICE + ' 코인)');
    } else if (result.events.indexOf('not_enough_coins') !== -1) {
      Toast.show('코인이 부족해요. 산책과 접속 보상으로 모아보세요!', 'warn');
    }

    App.refreshHeader();
    render();
  }

  function _setBackground(bg) {
    const player = DB.Player.get();
    if (player.background === bg) return;

    player.background = bg;
    DB.Player.save(player);
    App.applyBackground();
    render();
    Toast.show('배경을 바꿨어요!');
  }

  function bind() {
    document.getElementById('btn-buy-food').addEventListener('click', _buyFood);
    document.querySelectorAll('.bg-option').forEach(function (el) {
      el.addEventListener('click', function () {
        _setBackground(el.dataset.bg);
      });
    });
  }

  return { render: render, bind: bind };
})();
