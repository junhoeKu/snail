/**
 * HomeModule — 홈 화면 (서식지 오버레이 / 부화 온보딩 / 먹이·산책 액션)
 * 전역 네임스페이스: HomeModule
 */
const HomeModule = (function () {
  'use strict';

  /** 이벤트 → 사용자 메시지 (성공) */
  function _successMessage(event) {
    switch (event) {
      case 'fed': return '냠냠! 맛있게 먹었어요 (+' + GAME.CONFIG.FEED_EXP + ' EXP)';
      case 'walked': return '산책을 다녀왔어요! (+' + GAME.CONFIG.WALK_COINS + ' 코인)';
      default: return null;
    }
  }

  /** 이벤트 → 사용자 메시지 (실패) */
  function _failMessage(event, player) {
    switch (event) {
      case 'no_food': return '상추가 없어요. 상점에서 구매하세요!';
      case 'not_hungry': return '지금은 배고프지 않아요.';
      case 'walk_cooldown': return '산책은 ' + _walkRemainText(player) + ' 후에 갈 수 있어요.';
      case 'name_required': return '이름을 입력해주세요.';
      default: return null;
    }
  }

  function _walkRemainText(player) {
    const cooldownMs = GAME.CONFIG.WALK_COOLDOWN_HOURS * 60 * 60 * 1000;
    const remainMs = cooldownMs - (new Date(DB.now()) - new Date(player.last_walk));
    const remainMin = Math.max(1, Math.ceil(remainMs / 60000));
    if (remainMin >= 60) {
      return Math.floor(remainMin / 60) + '시간 ' + (remainMin % 60) + '분';
    }
    return remainMin + '분';
  }

  function render() {
    const snail = DB.Snail.get();
    const isEgg = snail.stage === 'egg';

    document.getElementById('egg-view').classList.toggle('hidden', !isEgg);
    document.getElementById('snail-view').classList.toggle('hidden', isEgg);
    if (isEgg) return;

    const stage = GAME.STAGES[snail.stage];
    // 스프라이트는 인라인 SVG — 단계별 크기, 변이 색, 컨디션 표정은 클래스가 제어한다
    const condition = GAME.conditionOf(snail);
    document.getElementById('snail-sprite').className =
      'snail-sprite stage-' + snail.stage +
      ' variant-' + (snail.color || 'brown') +
      (condition.id !== 'normal' ? ' cond-' + condition.id : '');

    document.getElementById('chip-name-level').textContent =
      snail.name + ' · Lv.' + snail.level + ' ' + stage.label;
    document.getElementById('chip-hunger').textContent = snail.hunger;
    document.getElementById('chip-happiness').textContent = snail.happiness;

    _renderMissionChip();
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
    if (events.indexOf('walked') !== -1) kinds.push('walk');
    if (events.indexOf('petted') !== -1) kinds.push('pet');

    kinds.forEach(function (kind) {
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
        DecoModule.claimUnlocks(); // 들꽃(완주 누적) 해금 확인
      }
    });

    if (kinds.length > 0) {
      App.refreshHeader();
      _renderMissionChip();
    }
  }

  /** 행동 결과 저장 + 렌더링 + 이벤트 연출 */
  function _handleResult(result) {
    const failed = result.events.some(function (ev) {
      return _failMessage(ev, result.player || DB.Player.get()) !== null;
    });

    if (!failed) {
      if (result.snail) DB.Snail.save(result.snail);
      if (result.player) DB.Player.save(result.player);
    }

    App.refreshHeader();
    render();
    StatsModule.render();
    _showEvents(result.events, result.player || DB.Player.get());
    _recordMissions(result.events);
  }

  function _showEvents(events, player) {
    events.forEach(function (ev) {
      const fail = _failMessage(ev, player);
      if (fail) {
        Toast.show(fail, 'warn');
        return;
      }

      const success = _successMessage(ev);
      if (success) Toast.show(success);

      if (ev === 'fed') _popSprite();

      if (ev === 'walked') {
        Sound.play('coin');
        const fab = document.getElementById('btn-walk').getBoundingClientRect();
        FX.flyCoins(fab.left + fab.width / 2, fab.top, 2);
      }

      if (ev === 'levelup') {
        const level = DB.Snail.get().level;
        Sound.play('fanfare');
        Toast.show('🎉 레벨 업! Lv.' + level);
        DB.Journal.add('levelup', 'Lv.' + level + '이 되었어요!');
      }

      if (ev === 'stage_up') {
        const snail = DB.Snail.get();
        const messages = {
          junior: '껍질이 커졌습니다!',
          adult: '색이 짙어졌어요! 어엿한 성체가 되었습니다.'
        };
        FX.confetti(14);
        Toast.celebrate({
          emoji: GAME.STAGES[snail.stage].emoji,
          title: 'Lv ' + snail.level + ' — ' + GAME.STAGES[snail.stage].label + ' 달팽이',
          message: messages[snail.stage] || '성장했어요!'
        });
        DB.Journal.add('stage_up',
          GAME.STAGES[snail.stage].label + ' 달팽이로 자랐어요. ' + (messages[snail.stage] || ''));
      }
    });
  }

  function _popSprite() {
    const sprite = document.getElementById('snail-sprite');
    sprite.classList.remove('pop');
    void sprite.offsetWidth; // 애니메이션 재시작 트릭
    sprite.classList.add('pop');
  }

  function _hatch() {
    const input = document.getElementById('snail-name-input');
    const generation = DB.Player.get().generation || 1;
    const result = GAME.hatch(DB.Snail.get(), input.value, undefined, generation);

    if (result.events.indexOf('hatched') === -1) {
      _showEvents(result.events, DB.Player.get());
      return;
    }

    DB.Snail.save(result.snail);

    // 부화 시점부터 시간 감쇠를 시작한다
    const player = DB.Player.get();
    player.last_seen = DB.now();
    DB.Player.save(player);

    // 성장 일지: 탄생 + 변이 + 성격
    DB.Journal.add('hatch', result.snail.name +
      (generation > 1 ? ' (' + generation + '세대)' : '') + '(이)가 알을 깨고 태어났어요!');
    const variant = GAME.VARIANTS[result.snail.color];
    if (variant && variant.id !== 'brown') {
      DB.Journal.add('variant', (variant.id === 'golden' ? '반짝이는 황금빛' : variant.label) +
        ' 껍질을 가지고 태어났어요!');
    }
    DB.Journal.add('personality',
      '성격은 "' + GAME.PERSONALITIES[result.snail.personality].label + '"인 것 같아요.');

    render();
    StatsModule.render();
    HabitatModule.onHatched();
    Sound.play('fanfare');
    Sound.vibrate(30);
    FX.confetti(16);
    Toast.celebrate({
      emoji: variant && variant.id === 'golden' ? '✨' : '🐌',
      title: '부화 성공!',
      message: result.snail.name + '(이)가 태어났어요. 잘 돌봐주세요!'
    });
  }

  function _feed() {
    // 즉시 정산하지 않고 서식지에 상추를 떨어뜨린다 (먹기 완료 시 정산)
    HabitatModule.dropFoodRandom();
  }

  function _walk() {
    _handleResult(GAME.walk(DB.Snail.get(), DB.Player.get(), DB.now()));
  }

  /** 쓰다듬기 (서식지에서 달팽이 터치 시 HabitatModule이 호출) */
  function handlePet() {
    const result = GAME.pet(DB.Snail.get(), DB.Player.get(), DB.now());

    if (result.events.indexOf('petted') !== -1) {
      DB.Snail.save(result.snail);
      DB.Player.save(result.player);
      render();
      StatsModule.render();
      Sound.play('heart');
      HabitatModule.effect('💗');
      _recordMissions(result.events);
      return;
    }
    if (result.events.indexOf('pet_cooldown') !== -1) {
      // 쿨다운 중엔 작은 하트만, 효과/토스트 없음
      HabitatModule.effect('♡');
    }
  }

  function bind() {
    document.getElementById('btn-hatch').addEventListener('click', _hatch);
    document.getElementById('snail-name-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') _hatch();
    });
    document.getElementById('btn-feed').addEventListener('click', _feed);
    document.getElementById('btn-walk').addEventListener('click', _walk);
    document.getElementById('snail-chip').addEventListener('click', function () {
      App.navigate('stats');
    });
    document.getElementById('mission-chip').addEventListener('click', _showMissionSheet);
  }

  return {
    render: render,
    bind: bind,
    handleResult: _handleResult, // 서식지(HabitatModule)의 먹기 정산에서 재사용
    handlePet: handlePet,
    failMessage: _failMessage
  };
})();
