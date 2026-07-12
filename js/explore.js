/**
 * ExploreModule — 탐험 채집 (맵 선택 → 수풀 뒤지기)
 * 전역 네임스페이스: ExploreModule
 */
const ExploreModule = (function () {
  'use strict';

  // 뒤지기 오브젝트 후보 위치 (% 좌표) — 입장마다 셔플해 6곳 사용
  const SPOT_POSITIONS = [
    { x: 18, y: 30 }, { x: 62, y: 24 }, { x: 82, y: 42 }, { x: 30, y: 52 },
    { x: 70, y: 62 }, { x: 22, y: 76 }, { x: 52, y: 82 }, { x: 84, y: 78 }
  ];
  const SPOT_EMOJI = ['🌱', '🍂', '🪨', '🌾', '🍃', '🌿'];
  const SPOTS_PER_ENTER = 6;

  let _currentMap = null;

  function _staminaText() {
    const player = DB.Player.get();
    const left = GAME.exploreStamina(player, DB.today());
    return '오늘 남은 뒤지기: ' + left + '/' + GAME.exploreMaxSearches(player);
  }

  /** 맵 선택 화면 */
  function render() {
    _showSelect();
    document.getElementById('explore-stamina').textContent = _staminaText();

    const player = DB.Player.get();
    const list = document.getElementById('explore-maps');
    list.innerHTML = '';

    Object.keys(GAME.EXPLORE_MAPS).forEach(function (mapId) {
      const map = GAME.EXPLORE_MAPS[mapId];
      const available = GAME.mapAvailable(player, mapId);

      const li = document.createElement('li');
      li.className = 'explore-map-card' + (available ? '' : ' locked');

      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'explore-map-name';
      name.textContent = map.emoji + ' ' + map.label;
      const desc = document.createElement('div');
      desc.className = 'explore-map-desc';
      desc.textContent = GAME.VARIANTS[map.variantBoost].label + ' 변이가 자주 나와요' +
        (map.goldenMult ? ' · 황금 확률 ' + map.goldenMult + '배!' : '');
      info.appendChild(name);
      info.appendChild(desc);
      li.appendChild(info);

      const action = document.createElement('div');
      if (available) {
        const enterBtn = document.createElement('button');
        enterBtn.className = 'btn btn-primary btn-sm';
        enterBtn.textContent = '입장';
        enterBtn.addEventListener('click', function () { _enter(mapId); });
        action.appendChild(enterBtn);
      } else {
        const unlockBtn = document.createElement('button');
        unlockBtn.className = 'btn btn-ghost btn-sm';
        unlockBtn.innerHTML = '🔒 ' + GAME.CONFIG.EXPLORE_MAP_PRICE + ' <i class="fa-solid fa-coins"></i>';
        unlockBtn.addEventListener('click', function () { _buyUnlock(mapId); });
        action.appendChild(unlockBtn);
        const hint = document.createElement('div');
        hint.className = 'explore-map-desc';
        hint.textContent = '2세대 도달 시 무료';
        action.appendChild(hint);
      }
      li.appendChild(action);
      list.appendChild(li);
    });
  }

  function _buyUnlock(mapId) {
    if (Api.enabled()) {
      Api.purchase('map', mapId).then(function (res) {
        Api.Net.apply(res);
        render();
      }).catch(Api.Net.fail);
      return;
    }

    const result = GAME.buyMapUnlock(DB.Player.get(), mapId);
    if (result.events.indexOf('map_unlocked') !== -1) {
      DB.Player.save(result.player);
      Sound.play('fanfare');
      Toast.show('🗺️ ' + GAME.EXPLORE_MAPS[mapId].label + ' 해금!');
      DB.Journal.add('map', GAME.EXPLORE_MAPS[mapId].label + ' 탐험 지도를 손에 넣었어요.');
      App.refreshHeader();
      render();
    } else if (result.events.indexOf('not_enough_coins') !== -1) {
      Toast.show('코인이 부족해요.', 'warn');
    }
  }

  function _showSelect() {
    document.getElementById('explore-select').classList.remove('hidden');
    document.getElementById('explore-map').classList.add('hidden');
    _currentMap = null;
  }

  /** 맵 입장 — 뒤지기 오브젝트 배치 */
  function _enter(mapId) {
    _currentMap = mapId;
    document.getElementById('explore-select').classList.add('hidden');
    document.getElementById('explore-map').classList.remove('hidden');

    const field = document.getElementById('explore-field');
    field.className = 'explore-field map-' + mapId;
    field.innerHTML = '';

    const positions = SPOT_POSITIONS.slice().sort(function () { return Math.random() - 0.5; })
      .slice(0, SPOTS_PER_ENTER);
    positions.forEach(function (pos, i) {
      const spot = document.createElement('button');
      spot.className = 'explore-spot';
      spot.textContent = SPOT_EMOJI[i % SPOT_EMOJI.length];
      spot.style.left = pos.x + '%';
      spot.style.top = pos.y + '%';
      spot.addEventListener('click', function () { _search(spot); });
      field.appendChild(spot);
    });

    document.getElementById('explore-map-stamina').textContent = _staminaText();
  }

  /** 결과를 지점에 표시 (양 모드 공용 연출) */
  function _showSpotResult(spotEl, result) {
    spotEl.disabled = true;
    spotEl.classList.add('searched');
    if (result.type === 'coins') {
      spotEl.textContent = '+' + result.amount + '🪙';
      Sound.play('coin');
      const rect = spotEl.getBoundingClientRect();
      FX.flyCoins(rect.left + rect.width / 2, rect.top, 2);
    } else if (result.type === 'food') {
      spotEl.textContent = '+' + result.amount + '🥬';
    } else if (result.type === 'egg') {
      spotEl.textContent = '🥚';
    } else {
      spotEl.textContent = '💨';
      Toast.show('이슬만 반짝이고 있었어요.');
    }
    document.getElementById('explore-map-stamina').textContent = _staminaText();
    document.getElementById('explore-stamina').textContent = _staminaText();
  }

  /** 뒤지기 1회 */
  function _search(spotEl) {
    if (spotEl.disabled) return;
    Sound.play('tap');

    if (Api.enabled()) {
      // 서버 판정 — 스태미나/확률/야생 알 수용 전부 서버
      Api.explore(_currentMap).then(function (res) {
        Api.Net.apply(res);
        const explored = (res.events || []).find(function (e) { return e.type === 'explored'; });
        if (explored) _showSpotResult(spotEl, explored.result);
        HabitatModule.sync(); // 야생 알 반영
      }).catch(function (error) {
        if (error && error.code === 'no_stamina') Toast.show('오늘은 더 뒤질 힘이 없어요. 내일 다시 와요!', 'warn');
        else Api.Net.fail(error);
      });
      return;
    }

    const result = GAME.explore(DB.Player.get(), _currentMap, DB.today());

    if (result.events.indexOf('no_stamina') !== -1) {
      Toast.show('오늘은 더 뒤질 힘이 없어요. 내일 다시 와요!', 'warn');
      return;
    }
    if (result.events.indexOf('map_locked') !== -1) return;

    if (result.result.type === 'egg') {
      _handleWildEgg(result.player, result.result.variant);
    } else {
      DB.Player.save(result.player);
    }
    _showSpotResult(spotEl, result.result);

    App.refreshHeader();
    App.gainKeeperXp('explore');
    HomeModule.recordMissions(['explored']);
  }

  /** 야생 알: 빈 보금자리가 있으면 수용, 가득이면 코인 전환 */
  function _handleWildEgg(playerAfter, variant) {
    const snailCount = DB.Snails.get().length;
    if (snailCount < (playerAfter.snail_slots || 1)) {
      DB.Player.save(playerAfter);
      const egg = GAME.newEgg(DB.now());
      egg.wild_variant = variant;
      DB.Snails.add(egg);
      DB.Journal.add('wild_egg',
        GAME.EXPLORE_MAPS[_currentMap].label + '에서 야생 알을 발견해 데려왔어요!');
      Sound.play('fanfare');
      FX.confetti(14);
      Toast.celebrate({
        emoji: '🥚',
        title: '야생 알 발견!',
        message: '서식지로 데려왔어요. 홈에서 터치해 이름을 지어주세요.'
      });
      HabitatModule.sync();
      return;
    }

    const converted = GAME.convertWildEgg(playerAfter);
    DB.Player.save(converted.player);
    Toast.show('🥚 야생 알을 발견했지만 보금자리가 가득해요 — 코인 ' +
      GAME.CONFIG.WILD_EGG_FALLBACK_COINS + '개로 바꿨어요. 상점에서 보금자리를 넓혀보세요!', 'warn');
  }

  function bind() {
    document.getElementById('btn-explore-exit').addEventListener('click', render);
  }

  return { render: render, bind: bind };
})();
