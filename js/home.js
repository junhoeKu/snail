/**
 * HomeModule — 홈 화면 (달팽이 상태 / 부화 온보딩 / 먹이·산책 액션)
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
    const sprite = document.getElementById('snail-sprite');
    sprite.textContent = stage.emoji;
    sprite.className = 'snail-sprite stage-' + snail.stage;

    document.getElementById('snail-name').textContent = snail.name;
    document.getElementById('snail-level').textContent = snail.level;
    document.getElementById('snail-stage-label').textContent = stage.label;

    const expNeeded = GAME.expToNext(snail.level);
    document.getElementById('exp-text').textContent = snail.exp + ' / ' + expNeeded;
    _setBar('bar-exp', (snail.exp / expNeeded) * 100);

    document.getElementById('hunger-text').textContent = snail.hunger + '%';
    _setBar('bar-hunger', snail.hunger);

    document.getElementById('happiness-text').textContent = snail.happiness + '%';
    _setBar('bar-happiness', snail.happiness);
  }

  function _setBar(id, percent) {
    document.getElementById(id).style.width = Math.max(0, Math.min(100, percent)) + '%';
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
    _showEvents(result.events, result.player || DB.Player.get());
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

      if (ev === 'levelup') {
        Toast.show('🎉 레벨 업! Lv.' + DB.Snail.get().level);
      }

      if (ev === 'stage_up') {
        const snail = DB.Snail.get();
        const messages = {
          junior: '껍질이 커졌습니다!',
          adult: '색이 변했어요! 어엿한 성체가 되었습니다.'
        };
        Toast.celebrate({
          emoji: GAME.STAGES[snail.stage].emoji,
          title: 'Lv ' + snail.level + ' — ' + GAME.STAGES[snail.stage].label + ' 달팽이',
          message: messages[snail.stage] || '성장했어요!'
        });
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
    const result = GAME.hatch(DB.Snail.get(), input.value);

    if (result.events.indexOf('hatched') === -1) {
      _showEvents(result.events, DB.Player.get());
      return;
    }

    DB.Snail.save(result.snail);

    // 부화 시점부터 시간 감쇠를 시작한다
    const player = DB.Player.get();
    player.last_seen = DB.now();
    DB.Player.save(player);

    render();
    HabitatModule.onHatched();
    Toast.celebrate({
      emoji: '🐌',
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

  function bind() {
    document.getElementById('btn-hatch').addEventListener('click', _hatch);
    document.getElementById('snail-name-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') _hatch();
    });
    document.getElementById('btn-feed').addEventListener('click', _feed);
    document.getElementById('btn-walk').addEventListener('click', _walk);
  }

  return {
    render: render,
    bind: bind,
    handleResult: _handleResult, // 서식지(HabitatModule)의 먹기 정산에서 재사용
    failMessage: _failMessage
  };
})();
