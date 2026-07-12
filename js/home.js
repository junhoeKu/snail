/**
 * HomeModule — 홈 화면 (요약 칩 / 부화 / 먹이·쓰다듬기 액션 / 미션)
 * 전역 네임스페이스: HomeModule
 */
const HomeModule = (function () {
  'use strict';

  /** 이벤트 → 사용자 메시지 (실패) */
  function _failMessage(event, player) {
    switch (event) {
      case 'no_food': return '선택한 먹이가 없어요. 상점에서 구매하세요!';
      case 'not_hungry': return '지금은 다들 배고프지 않아요.';
      case 'name_required': return '이름을 입력해주세요.';
      default: return null;
    }
  }

  /** 먹이 선택 시트 (지갑 먹이 칩 클릭) */
  function _showFoodSheet() {
    const player = DB.Player.get();
    const root = document.getElementById('modal-root');
    root.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal-box';

    const title = document.createElement('h3');
    title.textContent = '먹이 선택';
    box.appendChild(title);

    const list = document.createElement('div');
    list.className = 'food-sheet';
    Object.keys(GAME.FOOD_DEFS).forEach(function (id) {
      const def = GAME.FOOD_DEFS[id];
      const unlocked = GAME.foodUnlocked(player, id);
      const owned = (player.foods && player.foods[id]) || 0;

      const row = document.createElement('button');
      row.className = 'food-sheet-row' +
        (player.selected_food === id ? ' active' : '') + (unlocked ? '' : ' locked');
      row.disabled = !unlocked;

      const head = document.createElement('div');
      head.className = 'food-sheet-name';
      head.textContent = def.emoji + ' ' + def.label + (unlocked ? '  ×' + owned : '');
      const desc = document.createElement('div');
      desc.className = 'food-sheet-desc';
      desc.textContent = unlocked
        ? '배고픔 -' + def.hunger + ' · EXP +' + def.exp + ' · 행복 +' + def.happiness
        : '🔒 양육자 Lv.' + def.unlockLevel + ' 해금';
      row.appendChild(head);
      row.appendChild(desc);

      row.addEventListener('click', function () {
        const p = DB.Player.get();
        p.selected_food = id;
        DB.Player.save(p);
        if (Api.enabled()) Api.updateSettings({ selected_food: id }).catch(function () { /* 무시 */ });
        App.refreshHeader();
        overlay.remove();
        Toast.show(def.emoji + ' ' + def.label + ' 선택!');
      });
      list.appendChild(row);
    });
    box.appendChild(list);

    const close = document.createElement('button');
    close.className = 'btn btn-ghost btn-wide';
    close.textContent = '닫기';
    close.addEventListener('click', function () { overlay.remove(); });
    box.appendChild(close);

    overlay.appendChild(box);
    root.appendChild(overlay);
  }

  function render() {
    const snails = DB.Snails.get();
    const onboarding = snails.length === 1 && snails[0].stage === 'egg';

    document.getElementById('egg-view').classList.toggle('hidden', !onboarding);
    document.getElementById('snail-view').classList.toggle('hidden', onboarding);
    if (onboarding) return;

    HabitatModule.sync();
    _renderChip(snails);
    _renderMissionChip();
  }

  /** 좌상단 요약 칩: 1마리면 상세, 여럿이면 무리 요약 */
  function _renderChip(snails) {
    const hatched = snails.filter(function (s) { return s.stage !== 'egg'; });
    const eggs = snails.length - hatched.length;
    const summaryEl = document.getElementById('chip-summary');
    const subEl = document.getElementById('chip-sub');

    if (hatched.length === 1) {
      const s = hatched[0];
      summaryEl.textContent = s.name + ' · Lv.' + s.level + ' ' + GAME.STAGES[s.stage].label +
        (eggs > 0 ? ' · 알 ' + eggs : '');
      subEl.textContent = '배고픔 ' + s.hunger + '% · 행복 ' + s.happiness + '%';
      return;
    }

    const hungryCount = hatched.filter(function (s) { return s.hunger > 0; }).length;
    summaryEl.textContent = '달팽이 ' + hatched.length + '마리' + (eggs > 0 ? ' · 알 ' + eggs : '');
    subEl.textContent = hungryCount > 0 ? '배고픈 아이 ' + hungryCount : '모두 든든해요';
  }

  function _renderMissionChip() {
    const progress = GAME.missionProgress(DB.Player.get(), DB.today());
    document.getElementById('mission-progress').textContent = progress.done + '/' + progress.total;
    document.getElementById('mission-chip').classList.toggle('all-done', progress.allDone);
  }

  /** 미션 시트 (오늘의 돌봄 목록 오버레이) */
  function _showMissionSheet() {
    const player = DB.Player.get();
    const progress = GAME.missionProgress(player, DB.today());
    const streak = player.streak && player.streak.count ? player.streak.count : 0;

    const lines = progress.items.map(function (item) {
      return (item.done ? '✅' : '⬜') + ' ' + item.label + '  ' + item.count + '/' + item.goal +
        '  (+' + GAME.CONFIG.MISSION_REWARD_COINS + ' 코인)';
    });
    lines.push((progress.allDone ? '✅' : '🎁') + ' 완주 보너스  +' +
      GAME.CONFIG.MISSION_BONUS_COINS + ' 코인, 상추 +' + GAME.CONFIG.MISSION_BONUS_FOOD);
    if (streak > 0) lines.push('🔥 연속 접속 ' + streak + '일째');

    Toast.report({
      emoji: '📋',
      title: '오늘의 돌봄',
      lines: lines,
      buttonLabel: '닫기'
    });
  }

  /** 행동 이벤트 → 미션 진행 반영 (서버 모드는 서버가 판정) */
  function _recordMissions(events) {
    if (Api.enabled()) return;
    const kinds = [];
    if (events.indexOf('fed') !== -1) kinds.push('feed');
    if (events.indexOf('petted') !== -1) kinds.push('pet');
    if (events.indexOf('explored') !== -1) kinds.push('explore');

    kinds.forEach(function (kind) {
      if (!GAME.MISSION_DEFS[kind]) return;
      const result = GAME.recordMission(DB.Player.get(), kind, DB.today());
      DB.Player.save(result.player);
      if (result.events.indexOf('mission_done') !== -1) {
        Sound.play('coin');
        const chip = document.getElementById('mission-chip').getBoundingClientRect();
        FX.flyCoins(chip.left + chip.width / 2, chip.top, 2);
        Toast.show('✅ 미션 완료: ' + GAME.MISSION_DEFS[kind].label +
          ' (+' + GAME.CONFIG.MISSION_REWARD_COINS + ' 코인)');
        App.gainKeeperXp('mission');
      }
      if (result.events.indexOf('mission_all_done') !== -1) {
        Toast.show('🎉 오늘의 돌봄 완주! +' + GAME.CONFIG.MISSION_BONUS_COINS +
          ' 코인, 상추 +' + GAME.CONFIG.MISSION_BONUS_FOOD);
        DB.Journal.add('mission', '오늘의 돌봄을 모두 완료했어요.');
        DecoModule.claimUnlocks();
        App.gainKeeperXp('mission_all');
      }
    });

    if (kinds.length > 0) {
      App.refreshHeader();
      _renderMissionChip();
    }
  }

  /**
   * 행동 결과 저장 + 렌더링 + 이벤트 연출.
   * result.snail은 id를 가지므로 해당 개체에만 반영된다.
   */
  function _handleResult(result) {
    const failed = result.events.some(function (ev) {
      return _failMessage(ev, result.player || DB.Player.get()) !== null;
    });

    if (!failed) {
      if (result.snail && result.snail.id) DB.Snails.saveOne(result.snail);
      if (result.player) DB.Player.save(result.player);
    }

    App.refreshHeader();
    render();
    StatsModule.render();
    _showEvents(result);
    _recordMissions(result.events);
  }

  function _showEvents(result) {
    const snail = result.snail;
    result.events.forEach(function (ev) {
      const fail = _failMessage(ev, result.player || DB.Player.get());
      if (fail) {
        Toast.show(fail, 'warn');
        return;
      }

      if (ev === 'fed') {
        Toast.show('냠냠! ' + (snail ? snail.name : '') + ' 맛있게 먹었어요 (+' +
          (result.food ? result.food.exp : '') + ' EXP)');
      }

      if (ev === 'levelup' && snail) {
        Sound.play('fanfare');
        Toast.show('🎉 ' + snail.name + ' 레벨 업! Lv.' + snail.level);
        DB.Journal.add('levelup', snail.name + '(이)가 Lv.' + snail.level + '이 되었어요!');
      }

      if (ev === 'stage_up' && snail) {
        const messages = {
          junior: '껍질이 커졌습니다!',
          adult: '색이 짙어졌어요! 어엿한 성체가 되었습니다.'
        };
        FX.confetti(14);
        Toast.celebrate({
          emoji: GAME.STAGES[snail.stage].emoji,
          title: snail.name + ' — ' + GAME.STAGES[snail.stage].label + ' 달팽이',
          message: messages[snail.stage] || '성장했어요!'
        });
        DB.Journal.add('stage_up',
          snail.name + '(이)가 ' + GAME.STAGES[snail.stage].label + ' 달팽이로 자랐어요.');
      }
    });
  }

  /** 알 이름 짓기 다이얼로그 (서식지 알 터치 / 달팽이 탭에서 호출) */
  function openHatchDialog(snailId) {
    const rec = DB.Snails.getById(snailId);
    if (!rec || rec.stage !== 'egg') return;
    Toast.prompt({
      title: '알이 꿈틀거려요!',
      message: '태어날 달팽이의 이름을 지어주세요.',
      placeholder: '이름 (최대 12자)',
      onSubmit: function (name) { _hatchById(snailId, name); }
    });
  }

  function _hatchById(snailId, name) {
    const rec = DB.Snails.getById(snailId);
    if (!rec) return;

    if (Api.enabled()) {
      Api.hatch(snailId, name).then(function (res) {
        Api.Net.apply(res);
        HabitatModule.sync();
      }).catch(function (error) {
        if (error && error.code === 'name_required') Toast.show('이름을 입력해주세요.', 'warn');
        else Api.Net.fail(error);
      });
      return;
    }

    const generation = DB.Player.get().generation || 1;
    const dexBefore = GAME.discoveredVariants(DB.Album.get(), DB.Snails.get()).length;
    const result = GAME.hatch(rec, name, undefined, generation);

    if (result.events.indexOf('hatched') === -1) {
      const fail = _failMessage(result.events[0], DB.Player.get());
      if (fail) Toast.show(fail, 'warn');
      return;
    }

    DB.Snails.saveOne(result.snail);
    App.gainKeeperXp('hatch');
    if (GAME.discoveredVariants(DB.Album.get(), DB.Snails.get()).length > dexBefore) {
      Toast.show('📖 도감에 새 변이가 등록됐어요!');
      App.gainKeeperXp('dex_new');
    }

    // 시간 감쇠 기준 갱신 (첫 개체 부화 시)
    const player = DB.Player.get();
    if (!player.last_seen) player.last_seen = DB.now();
    DB.Player.save(player);

    // 성장 일지: 탄생 + 변이 + 성격
    DB.Journal.add('hatch', result.snail.name +
      (generation > 1 ? ' (' + generation + '세대)' : '') + '(이)가 알을 깨고 태어났어요!');
    const variant = GAME.VARIANTS[result.snail.color];
    if (variant && variant.rarity !== 'common') {
      DB.Journal.add('variant', result.snail.name + '(이)는 ' + variant.label + '(' +
        GAME.RARITIES[variant.rarity].label + ') 껍질을 가지고 태어났어요!');
    }
    DB.Journal.add('personality',
      result.snail.name + '의 성격은 "' + GAME.PERSONALITIES[result.snail.personality].label + '"인 것 같아요.');

    render();
    StatsModule.render();
    HabitatModule.sync();
    Sound.play('fanfare');
    Sound.vibrate(30);
    FX.confetti(16);
    const rarity = variant ? variant.rarity : 'common';
    Toast.celebrate({
      emoji: rarity === 'epic' ? '✨' : (rarity === 'rare' ? '💠' : '🐌'),
      title: rarity === 'epic' ? '에픽 달팽이 부화!!' : (rarity === 'rare' ? '레어 달팽이 부화!' : '부화 성공!'),
      message: result.snail.name + '(이)가 태어났어요. 잘 돌봐주세요!'
    });
  }

  /** 첫 실행 온보딩 (전체 화면 알) */
  function _hatchFirst() {
    const snails = DB.Snails.get();
    const input = document.getElementById('snail-name-input');
    _hatchById(snails[0].id, input.value);
  }

  function _feed() {
    HabitatModule.dropFoodRandom();
  }

  /** 쓰다듬기 (개체 팝업 버튼에서 호출) */
  function _petById(snailId) {
    const rec = DB.Snails.getById(snailId);
    if (!rec) return;
    const result = GAME.pet(rec, DB.Player.get(), DB.now());
    if (result.events.indexOf('petted') === -1) return;

    DB.Snails.saveOne(result.snail);
    DB.Player.save(result.player);
    render();
    StatsModule.render();
    Sound.play('heart');
    HabitatModule.effect('💗', snailId);
    _recordMissions(result.events);
  }

  // ── 개체 팝업 (달팽이 클릭) ────────────────────────────

  function openSnailPopup(snailId) {
    _renderSnailPopup(snailId);
  }

  function _popupBar(label, valueText, percent, fillClass) {
    const row = document.createElement('div');
    row.className = 'stat';
    const head = document.createElement('div');
    head.className = 'stat-head';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    const valueSpan = document.createElement('span');
    valueSpan.textContent = valueText;
    head.appendChild(labelSpan);
    head.appendChild(valueSpan);
    const bar = document.createElement('div');
    bar.className = 'stat-bar';
    const fill = document.createElement('div');
    fill.className = 'stat-fill ' + fillClass;
    fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
    bar.appendChild(fill);
    row.appendChild(head);
    row.appendChild(bar);
    return row;
  }

  function _renderSnailPopup(snailId) {
    const rec = DB.Snails.getById(snailId);
    if (!rec || rec.stage === 'egg') return;

    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal-box snail-popup';

    const safeColor = GAME.VARIANTS[rec.color] ? rec.color : 'brown';
    const img = document.createElement('img');
    const rareVariant = GAME.VARIANTS[safeColor] && GAME.VARIANTS[safeColor].rarity !== 'common';
    img.className = 'popup-img' + (rareVariant ? ' popup-rare' : '');
    img.src = GAME.spritePath(safeColor, rec.stage);
    img.alt = rec.name;
    box.appendChild(img);

    const title = document.createElement('h3');
    title.textContent = rec.name;
    box.appendChild(title);

    const personality = GAME.PERSONALITIES[rec.personality];
    const variant = GAME.VARIANTS[rec.color] || GAME.VARIANTS.brown;
    const rarityTag = variant.rarity !== 'common'
      ? ' (' + GAME.RARITIES[variant.rarity].label + ')' : '';
    const sub = document.createElement('p');
    sub.className = 'popup-sub';
    sub.textContent = 'Lv.' + rec.level + ' ' + GAME.STAGES[rec.stage].label + ' · ' +
      variant.label + ' 껍질' + rarityTag + ' · ' + (personality ? personality.label : '?');
    box.appendChild(sub);

    if (personality && personality.desc) {
      const desc = document.createElement('p');
      desc.className = 'popup-desc';
      desc.textContent = '"' + personality.desc + '"';
      box.appendChild(desc);
    }

    const expNeeded = GAME.expToNext(rec.level);
    box.appendChild(_popupBar('⭐ 경험치', rec.exp + ' / ' + expNeeded, (rec.exp / expNeeded) * 100, 'fill-exp'));
    box.appendChild(_popupBar('🍀 배고픔', rec.hunger + '%', rec.hunger, 'fill-hunger'));
    box.appendChild(_popupBar('😊 행복', rec.happiness + '%', rec.happiness, 'fill-happiness'));

    const actions = document.createElement('div');
    actions.className = 'popup-actions';
    const feedBtn = document.createElement('button');
    feedBtn.className = 'btn btn-primary';
    const selectedDef = GAME.FOOD_DEFS[DB.Player.get().selected_food] || GAME.FOOD_DEFS.lettuce;
    feedBtn.textContent = selectedDef.emoji + ' 먹이주기';
    feedBtn.addEventListener('click', function () {
      overlay.remove();
      HabitatModule.dropFoodNear(snailId); // 이 아이 근처에 드롭
    });
    const petBtn = document.createElement('button');
    petBtn.className = 'btn btn-ghost';
    petBtn.textContent = '🖐️ 쓰다듬기';
    petBtn.addEventListener('click', function () {
      if (Api.enabled()) {
        Api.pet(snailId).then(function (res) {
          Api.Net.apply(res);
          Sound.play('heart');
          HabitatModule.effect('💗', snailId);
          _renderSnailPopup(snailId);
        }).catch(function (err) {
          if (err && err.code === 'network') {
            Api.queuePet(snailId);
            Sound.play('heart');
            HabitatModule.effect('💗', snailId);
            _renderSnailPopup(snailId);
          } else {
            Api.Net.fail(err);
          }
        });
        return;
      }
      _petById(snailId);
      _renderSnailPopup(snailId); // 수치 즉시 갱신
    });
    actions.appendChild(feedBtn);
    actions.appendChild(petBtn);
    box.appendChild(actions);

    if (GAME.canGraduate(rec)) {
      const gradBtn = document.createElement('button');
      gradBtn.className = 'btn btn-primary btn-wide popup-graduate';
      gradBtn.innerHTML = '<i class="fa-solid fa-suitcase"></i> 여행 보내기';
      gradBtn.addEventListener('click', function () {
        overlay.remove();
        _confirmGraduate(snailId);
      });
      box.appendChild(gradBtn);
    }

    const close = document.createElement('button');
    close.className = 'btn btn-ghost btn-wide popup-close';
    close.textContent = '닫기';
    close.addEventListener('click', function () { overlay.remove(); });
    box.appendChild(close);

    overlay.appendChild(box);
    root.appendChild(overlay);
  }

  // ── 여행 보내기 (팝업에서 진입) ────────────────────────

  function _confirmGraduate(snailId) {
    const snail = DB.Snails.getById(snailId);
    if (!snail || !GAME.canGraduate(snail)) return;

    Toast.confirm({
      title: '여행 보내기',
      message: snail.name + '(이)가 넓은 세상으로 여행을 떠나요. 영영 이별이 아니라 앨범에 남고, 그 자리에 새 알이 도착해요!',
      confirmLabel: '보내기',
      confirmClass: 'btn-primary',
      onConfirm: function () { _doGraduate(snailId); }
    });
  }

  function _doGraduate(snailId) {
    const rec = DB.Snails.getById(snailId);
    if (!rec) return;

    if (Api.enabled()) {
      Api.graduate(snailId).then(function (res) {
        Api.Net.apply(res);
        HabitatModule.sync();
        App.navigate('home');
      }).catch(Api.Net.fail);
      return;
    }

    const result = GAME.graduate(rec, DB.Player.get(), DB.now());
    if (result.events.indexOf('graduated') === -1) return;

    DB.Album.add(result.record);
    DB.Snails.removeById(snailId);
    DB.Snails.add(result.snail); // 그 자리의 새 알
    DB.Player.save(result.player);
    DB.Journal.add('graduate',
      result.record.name + '(' + result.record.generation + '세대)가 넓은 세상으로 여행을 떠났어요.');

    HabitatModule.sync();
    App.refreshHeader();
    App.gainKeeperXp('graduate');
    DecoModule.claimUnlocks();
    render();
    StatsModule.render();
    Sound.play('fanfare');
    FX.confetti(16);
    Toast.celebrate({
      emoji: '🧳',
      title: '잘 다녀와, ' + result.record.name + '!',
      message: '추억은 앨범에 남았어요. 새 알이 도착했어요! (+' + GAME.CONFIG.GRADUATE_COINS + ' 코인)'
    });
  }

  function bind() {
    document.getElementById('btn-hatch').addEventListener('click', _hatchFirst);
    document.getElementById('snail-name-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') _hatchFirst();
    });
    document.getElementById('btn-feed').addEventListener('click', _feed);
    document.getElementById('snail-chip').addEventListener('click', function () {
      App.navigate('stats');
    });
    document.getElementById('mission-chip').addEventListener('click', _showMissionSheet);
    document.getElementById('wallet-food').addEventListener('click', _showFoodSheet);
  }

  return {
    render: render,
    bind: bind,
    handleResult: _handleResult,
    openSnailPopup: openSnailPopup,
    openHatchDialog: openHatchDialog,
    recordMissions: _recordMissions, // ExploreModule 등 외부 행동의 미션 반영
    failMessage: _failMessage
  };
})();
