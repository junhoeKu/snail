/**
 * DecoModule — 꾸미기 화면 (서식지 배경 선택)
 * 전역 네임스페이스: DecoModule
 */
const DecoModule = (function () {
  'use strict';

  function render() {
    const player = DB.Player.get();
    document.querySelectorAll('.bg-option').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.bg === player.background);
    });
    _renderDecoList();
  }

  /** 장식 목록: 보유(슬롯 배치) / 구매 / 해금 조건 */
  function _renderDecoList() {
    const player = DB.Player.get();
    const owned = player.decorations.owned;
    const slots = player.decorations.slots;
    const list = document.getElementById('deco-list');
    list.innerHTML = '';

    Object.keys(GAME.DECORATIONS).forEach(function (id) {
      const def = GAME.DECORATIONS[id];
      const li = document.createElement('li');
      li.className = 'deco-row';

      const icon = document.createElement('span');
      icon.className = 'deco-icon';
      const template = document.getElementById('deco-' + id);
      if (template) icon.appendChild(template.content.cloneNode(true));

      const info = document.createElement('div');
      info.className = 'deco-info';
      const name = document.createElement('div');
      name.className = 'deco-name';
      name.textContent = def.label;
      const status = document.createElement('div');
      status.className = 'deco-status';
      info.appendChild(name);
      info.appendChild(status);

      const action = document.createElement('div');
      action.className = 'deco-action';

      if (owned.indexOf(id) !== -1) {
        status.textContent = '보유 중 — 놓을 슬롯을 고르세요';
        for (let i = 0; i < 3; i++) {
          const slotBtn = document.createElement('button');
          slotBtn.className = 'slot-btn' + (slots[i] === id ? ' active' : '');
          slotBtn.textContent = i + 1;
          slotBtn.addEventListener('click', _toggleSlot.bind(null, id, i));
          action.appendChild(slotBtn);
        }
      } else if (def.type === 'buy') {
        status.textContent = '상점 판매';
        const buyBtn = document.createElement('button');
        buyBtn.className = 'btn btn-primary btn-sm';
        buyBtn.textContent = def.price + ' 코인';
        buyBtn.addEventListener('click', _buy.bind(null, id));
        action.appendChild(buyBtn);
      } else {
        li.classList.add('locked');
        status.textContent = '🔒 ' + def.unlockDesc + _unlockProgress(id, player);
      }

      li.appendChild(icon);
      li.appendChild(info);
      li.appendChild(action);
      list.appendChild(li);
    });
  }

  function _unlockProgress(id, player) {
    if (id === 'wildflower') {
      return ' (' + Math.min(player.mission_completions || 0, GAME.CONFIG.DECO_MISSIONS_REQUIRED) +
        '/' + GAME.CONFIG.DECO_MISSIONS_REQUIRED + ')';
    }
    if (id === 'mossrock') {
      return ' (현재 ' + (player.generation || 1) + '세대)';
    }
    return '';
  }

  function _toggleSlot(id, slotIndex) {
    const player = DB.Player.get();
    const result = (player.decorations.slots[slotIndex] === id)
      ? GAME.removeDecoration(player, slotIndex)
      : GAME.placeDecoration(player, id, slotIndex);
    DB.Player.save(result.player);
    HabitatModule.renderDecorations();
    render();
  }

  function _buy(id) {
    const result = GAME.buyDecoration(DB.Player.get(), id);
    if (result.events.indexOf('deco_bought') !== -1) {
      DB.Player.save(result.player);
      Toast.show('🎁 ' + GAME.DECORATIONS[id].label + ' 구매! 슬롯에 배치해보세요.');
      DB.Journal.add('deco', GAME.DECORATIONS[id].label + ' 장식을 들여놓았어요.');
      App.refreshHeader();
    } else if (result.events.indexOf('not_enough_coins') !== -1) {
      Toast.show('코인이 부족해요.', 'warn');
    }
    render();
  }

  /** 해금형 장식 자동 지급 — 부팅/미션 완주/여행 후 호출 */
  function claimUnlocks() {
    const result = GAME.claimDecorationUnlocks(DB.Player.get());
    if (result.unlocked.length === 0) return;

    DB.Player.save(result.player);
    result.unlocked.forEach(function (id) {
      Toast.show('🎉 장식 해금: ' + GAME.DECORATIONS[id].label + '! 꾸미기 탭에서 배치할 수 있어요.');
      DB.Journal.add('deco', GAME.DECORATIONS[id].label + ' 장식을 해금했어요.');
    });
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
    document.querySelectorAll('.bg-option').forEach(function (el) {
      el.addEventListener('click', function () {
        _setBackground(el.dataset.bg);
      });
    });
  }

  return { render: render, bind: bind, claimUnlocks: claimUnlocks };
})();
