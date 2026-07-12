/**
 * ShopModule — 상점 (상추 구매)
 * 전역 네임스페이스: ShopModule
 */
const ShopModule = (function () {
  'use strict';

  function render() {
    const player = DB.Player.get();
    document.getElementById('shop-coins').textContent = player.coins;
    _renderFoods(player);
    _renderEggSlot(player);
    DecoModule.render(); // 배경/장식 (상점에 통합)
  }

  /** 먹이 목록 (해금/보유/묶음 할인) */
  function _renderFoods(player) {
    const wrap = document.getElementById('shop-foods');
    wrap.innerHTML = '';

    Object.keys(GAME.FOOD_DEFS).forEach(function (id) {
      const def = GAME.FOOD_DEFS[id];
      const unlocked = GAME.foodUnlocked(player, id);
      const owned = (player.foods && player.foods[id]) || 0;

      const row = document.createElement('div');
      row.className = 'shop-item' + (unlocked ? '' : ' locked');

      const info = document.createElement('div');
      info.className = 'shop-item-info';
      const emoji = document.createElement('span');
      emoji.className = 'shop-item-icon';
      emoji.textContent = def.emoji;
      const text = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'shop-item-name';
      name.textContent = def.label + (unlocked ? ' · 보유 ' + owned : '');
      const desc = document.createElement('div');
      desc.className = 'shop-item-desc';
      desc.textContent = unlocked
        ? '배고픔 -' + def.hunger + ' · EXP +' + def.exp + ' · 행복 +' + def.happiness
        : '🔒 양육자 Lv.' + def.unlockLevel + ' 해금';
      text.appendChild(name);
      text.appendChild(desc);
      info.appendChild(emoji);
      info.appendChild(text);
      row.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'shop-food-actions';
      [1, GAME.CONFIG.FOOD_BUNDLE_COUNT].forEach(function (count) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary btn-sm';
        btn.disabled = !unlocked;
        btn.textContent = (count > 1 ? '×' + count + ' ' : '') + GAME.foodPrice(id, count) + '🪙';
        btn.addEventListener('click', function () { _buyFood(id, count); });
        actions.appendChild(btn);
      });
      row.appendChild(actions);
      wrap.appendChild(row);
    });
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

  function _buyFood(foodId, count) {
    const def = GAME.FOOD_DEFS[foodId];

    if (Api.enabled()) {
      Api.purchase('food', foodId, count).then(function (res) {
        Api.Net.apply(res);
        Toast.show(def.emoji + ' ' + def.label + ' ' + count + '개를 구매했어요!');
        render();
      }).catch(Api.Net.fail);
      return;
    }

    const result = GAME.buyFood(DB.Player.get(), foodId, count);

    if (result.events.indexOf('food_bought') !== -1) {
      DB.Player.save(result.player);
      Sound.play('coin');
      Toast.show(def.emoji + ' ' + def.label + ' ' + count + '개를 구매했어요!');
    } else if (result.events.indexOf('not_enough_coins') !== -1) {
      Toast.show('코인이 부족해요.', 'warn');
    } else if (result.events.indexOf('food_locked') !== -1) {
      Toast.show('아직 잠긴 먹이예요. 양육자 레벨을 올려보세요!', 'warn');
    }

    App.refreshHeader();
    render();
  }

  function _buyEgg() {
    if (Api.enabled()) {
      Api.purchase('egg_slot').then(function (res) {
        Api.Net.apply(res);
        Toast.show('🥚 알이 서식지에 도착했어요! 터치해서 이름을 지어주세요.');
        HabitatModule.sync();
        render();
      }).catch(Api.Net.fail);
      return;
    }

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
    document.getElementById('btn-buy-egg').addEventListener('click', _buyEgg);
  }

  return { render: render, bind: bind };
})();
