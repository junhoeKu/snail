/**
 * HomeModule — 홈 화면 (요약 칩 / 부화 / 먹이·쓰다듬기 액션 / 미션)
 * 전역 네임스페이스: HomeModule
 */
const HomeModule = (function () {
  'use strict';

  /** 이벤트 → 사용자 메시지 (실패) */
  function _failMessage(event, player) {
    switch (event) {
      case 'no_food': return '상추가 없어요. 상점에서 구매하세요!';
      case 'not_hungry': return '지금은 다들 배고프지 않아요.';
      case 'name_required': return '이름을 입력해주세요.';
      default: return null;
    }
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

  /** 행동 이벤트 → 미션 진행 반영 (달성 보상은 자동 지급 + 토스트) */
  function _recordMissions(events) {
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
      }
      if (result.events.indexOf('mission_all_done') !== -1) {
        Toast.show('🎉 오늘의 돌봄 완주! +' + GAME.CONFIG.MISSION_BONUS_COINS +
          ' 코인, 상추 +' + GAME.CONFIG.MISSION_BONUS_FOOD);
        DB.Journal.add('mission', '오늘의 돌봄을 모두 완료했어요.');
        DecoModule.claimUnlocks();
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
          GAME.CONFIG.FEED_EXP + ' EXP)');
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
    const generation = DB.Player.get().generation || 1;
    const result = GAME.hatch(rec, name, undefined, generation);

    if (result.events.indexOf('hatched') === -1) {
      const fail = _failMessage(result.events[0], DB.Player.get());
      if (fail) Toast.show(fail, 'warn');
      return;
    }

    DB.Snails.saveOne(result.snail);

    // 시간 감쇠 기준 갱신 (첫 개체 부화 시)
    const player = DB.Player.get();
    if (!player.last_seen) player.last_seen = DB.now();
    DB.Player.save(player);

    // 성장 일지: 탄생 + 변이 + 성격
    DB.Journal.add('hatch', result.snail.name +
      (generation > 1 ? ' (' + generation + '세대)' : '') + '(이)가 알을 깨고 태어났어요!');
    const variant = GAME.VARIANTS[result.snail.color];
    if (variant && variant.id !== 'brown') {
      DB.Journal.add('variant', result.snail.name + '(이)는 ' +
        (variant.id === 'golden' ? '반짝이는 황금빛' : variant.label) + ' 껍질을 가졌어요!');
    }
    DB.Journal.add('personality',
      result.snail.name + '의 성격은 "' + GAME.PERSONALITIES[result.snail.personality].label + '"인 것 같아요.');

    render();
    StatsModule.render();
    HabitatModule.sync();
    Sound.play('fanfare');
    Sound.vibrate(30);
    FX.confetti(16);
    Toast.celebrate({
      emoji: variant && variant.id === 'golden' ? '✨' : '🐌',
      title: '부화 성공!',
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

  /** 쓰다듬기 — 서식지에서 터치한 개체에만 적용 */
  function handlePet(snailId) {
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
  }

  return {
    render: render,
    bind: bind,
    handleResult: _handleResult,
    handlePet: handlePet,
    openHatchDialog: openHatchDialog,
    recordMissions: _recordMissions, // ExploreModule 등 외부 행동의 미션 반영
    failMessage: _failMessage
  };
})();
