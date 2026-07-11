/**
 * ShopModule — 상점 (상추 구매)
 * 전역 네임스페이스: ShopModule
 */
const ShopModule = (function () {
  'use strict';

  function render() {
    const player = DB.Player.get();
    document.getElementById('shop-coins').textContent = player.coins;
    _renderEggSlot(player);
    DecoModule.render(); // 배경/장식 (상점에 통합)
  }

  function _renderEggSlot(player) {
    const btn = document.getElementById('btn-buy-egg');
    const desc = document.getElementById('egg-slot-desc');
    const slots = player.snail_slots || 1;

    if (slots >= GAME.CONFIG.MAX_SNAILS) {
      btn.disabled = true;
      btn.textContent = '가득';
      desc.textContent = '보금자리가 가득해요 (' + slots + '/' + GAME.CONFIG.MAX_SNAILS + ')';
      return;
    }
    const price = GAME.CONFIG.EGG_SLOT_PRICES[slots];
    btn.disabled = false;
    btn.innerHTML = price + ' <i class="fa-solid fa-coins"></i>';
    desc.textContent = (slots + 1) + '번째 보금자리와 함께 알이 도착해요 (' +
      slots + '/' + GAME.CONFIG.MAX_SNAILS + ')';
  }

  function _buyFood(count) {
    const result = GAME.buyFood(DB.Player.get(), count);

    if (result.events.indexOf('food_bought') !== -1) {
      DB.Player.save(result.player);
      Sound.play('coin');
      Toast.show('🥬 상추 ' + count + '개를 구매했어요!');
    } else if (result.events.indexOf('not_enough_coins') !== -1) {
      Toast.show('코인이 부족해요.', 'warn');
    }

    App.refreshHeader();
    render();
  }

  function _buyEgg() {
    const result = GAME.buyEggSlot(DB.Player.get(), DB.now());

    if (result.events.indexOf('egg_bought') !== -1) {
      DB.Player.save(result.player);
      DB.Snails.add(result.egg);
      DB.Journal.add('egg', '새 보금자리에 알이 도착했어요!');
      Sound.play('fanfare');
      Toast.show('🥚 알이 서식지에 도착했어요! 터치해서 이름을 지어주세요.');
      HabitatModule.sync();
      App.refreshHeader();
    } else if (result.events.indexOf('not_enough_coins') !== -1) {
      Toast.show('코인이 부족해요.', 'warn');
    }
    render();
  }

  function bind() {
    document.getElementById('btn-buy-food').addEventListener('click', function () { _buyFood(1); });
    document.getElementById('btn-buy-food-bundle').addEventListener('click', function () {
      _buyFood(GAME.CONFIG.FOOD_BUNDLE_COUNT);
    });
    document.getElementById('btn-buy-egg').addEventListener('click', _buyEgg);
  }

  return { render: render, bind: bind };
})();
