/**
 * HabitatModule — 서식지 (멀티 달팽이 좌표/이동/먹이/알 오브젝트)
 * 전역 네임스페이스: HabitatModule
 *
 * 게임 밸런스 수치는 GAME.CONFIG에만 둔다. 여기의 MOTION은 연출/모션 수치 전용이다.
 * localStorage 직접 접근 금지 — 저장은 DB.Snails/DB.Player를 경유한다.
 * 규칙: 먹이 점유(claim)·이동은 연출 계층(여기), 스탯 정산은 GAME.feed가 담당.
 */
const HabitatModule = (function () {
  'use strict';

  // ── 모션/연출 수치 (QA/튜닝용 export) ──────────────────
  const MOTION = {
    WANDER_SPEED: 18,     // px/s
    SEEK_SPEED: 28,       // px/s
    IDLE_MIN_MS: 2000,
    IDLE_MAX_MS: 5000,
    EAT_DURATION_MS: 1800,
    EAT_DISTANCE: 30,     // px
    ARRIVE_DISTANCE: 2,   // px
    NAP_CHANCE: 0.1,      // idle 종료 시 낮잠 확률 (성격 배수 적용)
    NAP_MIN_MS: 60000,
    NAP_MAX_MS: 120000,
    EDGE_PADDING: 8,      // px (스프라이트 절반 크기에 더하는 여백)
    PET_RADIUS_MIN: 34,   // px (쓰다듬기 터치 판정 최소 반경)
    FOOD_MAX: 10,         // 필드 동시 상추 상한 (성능/UX 가드)
    FLIP_RIGHT: -1,       // 스프라이트가 왼쪽을 보므로 오른쪽 이동 시 반전
    FLIP_LEFT: 1
  };

  const STATE = {
    IDLE: 'idle',
    WANDERING: 'wandering',
    SEEKING: 'seeking_food',
    EATING: 'eating',
    NAPPING: 'napping'
  };

  // 알 오브젝트 배치 지점 (% 좌표)
  const EGG_SPOTS = [
    { x: '24%', y: '78%' },
    { x: '50%', y: '82%' },
    { x: '76%', y: '78%' }
  ];

  // 슬롯 위치 (장식 — 서식지 바닥, % 좌표)
  const DECO_SLOTS = [
    { x: '16%', y: '88%' },
    { x: '50%', y: '93%' },
    { x: '84%', y: '88%' }
  ];

  // 개체: { id, x, y, target, facing, state, idleUntil, eatUntil, napUntil,
  //         mods, hungry, food, root, spriteEl }
  let _ents = [];
  let _foods = []; // { x, y, el, claimedBy }
  let _rafId = null;
  let _lastTs = null;
  let _running = false;
  let _adminOn = false;

  // ── DOM/좌표 헬퍼 ──────────────────────────────────────

  function _habitat() { return document.getElementById('snail-habitat'); }
  function _layer() { return document.getElementById('snail-layer'); }
  function _foodLayer() { return document.getElementById('food-layer'); }

  function _bounds() {
    const el = _habitat();
    return { w: el.clientWidth, h: el.clientHeight };
  }

  function _edge(ent) {
    const half = (ent && ent.root ? ent.root.offsetWidth : 0) / 2;
    return half + MOTION.EDGE_PADDING;
  }

  function _clampPoint(x, y, edge) {
    const b = _bounds();
    return {
      x: Math.min(Math.max(x, edge), Math.max(b.w - edge, edge)),
      y: Math.min(Math.max(y, edge), Math.max(b.h - edge, edge))
    };
  }

  function _renderPosition(ent) {
    ent.root.style.transform =
      'translate3d(' + ent.x + 'px, ' + ent.y + 'px, 0) translate(-50%, -50%)';
  }

  // ── 개체 동기화 (DB → 화면) ────────────────────────────

  /** 첫 실행 온보딩(알 1개뿐)에는 서식지 대신 전체 화면 온보딩을 쓴다 */
  function _isOnboarding(snails) {
    return snails.length === 1 && snails[0].stage === 'egg';
  }

  /** DB 상태와 서식지 개체/알 오브젝트를 맞춘다 — 부화/구매/여행/스탯 변화 후 호출 */
  function sync() {
    const snails = DB.Snails.get();
    _adminOn = DB.Player.get().admin === true;
    const layer = _layer();

    // 사라진 개체 정리
    _ents = _ents.filter(function (ent) {
      const rec = snails.find(function (s) { return s.id === ent.id && s.stage !== 'egg'; });
      if (!rec) { ent.root.remove(); return false; }
      return true;
    });

    // 알 오브젝트는 매번 재구성 (수가 적어 비용 무시 가능)
    layer.querySelectorAll('.egg-item').forEach(function (el) { el.remove(); });

    if (_isOnboarding(snails)) {
      pause();
      return;
    }

    let eggIndex = 0;
    snails.forEach(function (rec) {
      if (rec.stage === 'egg') {
        _addEggEl(rec, eggIndex++);
        return;
      }
      let ent = _ents.find(function (e) { return e.id === rec.id; });
      if (!ent) ent = _spawn(rec);
      _applyLook(ent, rec);
      ent.hungry = rec.hunger > 0 || _adminOn;
    });

    resume();
  }

  function _spawn(rec) {
    const root = document.getElementById('snail-template').content.cloneNode(true).firstElementChild;
    _layer().appendChild(root);

    const b = _bounds();
    const ent = {
      id: rec.id,
      x: (rec.pos && rec.pos.rx || 0.5) * b.w,
      y: (rec.pos && rec.pos.ry || 0.5) * b.h,
      target: null,
      facing: 0,
      state: STATE.IDLE,
      idleUntil: 0,
      eatUntil: 0,
      napUntil: 0,
      mods: { wanderSpeed: MOTION.WANDER_SPEED, seekSpeed: MOTION.SEEK_SPEED, idleFactor: 1, napChance: MOTION.NAP_CHANCE },
      hungry: false,
      food: null,
      root: root,
      spriteEl: root.querySelector('.snail-sprite')
    };
    const p = _clampPoint(ent.x, ent.y, _edge(ent));
    ent.x = p.x;
    ent.y = p.y;
    _renderPosition(ent);
    _ents.push(ent);
    _setState(ent, STATE.IDLE);
    return ent;
  }

  /** 변이/단계/컨디션 반영 */
  function _applyLook(ent, rec) {
    const condition = GAME.conditionOf(rec);
    ent.spriteEl.className = 'snail-sprite stage-' + rec.stage +
      ' variant-' + (rec.color || 'brown') +
      (condition.id !== 'normal' ? ' cond-' + condition.id : '');
    const shell = ent.spriteEl.querySelector('.shell-base');
    if (shell) shell.setAttribute('fill', 'url(#shell-grad-' + (rec.color || 'brown') + ')');
  }

  function _addEggEl(rec, index) {
    const spot = EGG_SPOTS[index % EGG_SPOTS.length];
    const el = document.getElementById('egg-template').content.cloneNode(true).firstElementChild;
    el.style.left = spot.x;
    el.style.top = spot.y;
    el.addEventListener('pointerdown', function (e) {
      e.stopPropagation(); // 먹이 드롭과 충돌 방지
      HomeModule.openHatchDialog(rec.id);
    });
    _layer().appendChild(el);
  }

  // ── 상태 머신 (개체별) ─────────────────────────────────

  function _computeMods(ent) {
    const rec = DB.Snails.getById(ent.id);
    if (!rec) return;
    const weather = GAME.WEATHER[GAME.weatherFor(DB.today())];
    const condition = GAME.conditionOf(rec);
    const personality = GAME.PERSONALITIES[rec.personality] ||
      { seekFactor: 1, idleFactor: 1, napFactor: 1 };

    ent.mods = {
      wanderSpeed: MOTION.WANDER_SPEED * weather.speedFactor * condition.speedFactor,
      seekSpeed: MOTION.SEEK_SPEED * weather.speedFactor * condition.speedFactor * personality.seekFactor,
      idleFactor: weather.idleFactor * personality.idleFactor,
      napChance: MOTION.NAP_CHANCE * personality.napFactor
    };
    _applyLook(ent, rec);
  }

  function _setState(ent, next) {
    ent.state = next;
    ent.root.className = 'snail-entity state-' + next;
    _computeMods(ent);

    if (next === STATE.IDLE) {
      ent.target = null;
      ent.idleUntil = performance.now() +
        (MOTION.IDLE_MIN_MS + Math.random() * (MOTION.IDLE_MAX_MS - MOTION.IDLE_MIN_MS)) * ent.mods.idleFactor;
      const p = _clampPoint(ent.x, ent.y, _edge(ent));
      ent.x = p.x;
      ent.y = p.y;
      _renderPosition(ent);
      _savePosition(ent);
    }
  }

  function _savePosition(ent) {
    const b = _bounds();
    if (!b.w || !b.h) return;
    const rec = DB.Snails.getById(ent.id);
    if (!rec) return;
    rec.pos = {
      rx: Math.round((ent.x / b.w) * 1000) / 1000,
      ry: Math.round((ent.y / b.h) * 1000) / 1000
    };
    DB.Snails.saveOne(rec);
  }

  function _startWander(ent) {
    const edge = _edge(ent);
    const b = _bounds();
    ent.target = _clampPoint(
      edge + Math.random() * Math.max(b.w - edge * 2, 1),
      edge + Math.random() * Math.max(b.h - edge * 2, 1),
      edge
    );
    _setState(ent, STATE.WANDERING);
  }

  function _startNap(ent) {
    ent.target = null;
    ent.napUntil = performance.now() +
      MOTION.NAP_MIN_MS + Math.random() * (MOTION.NAP_MAX_MS - MOTION.NAP_MIN_MS);
    _setState(ent, STATE.NAPPING);
    _floatAt(ent.x, ent.y - _edge(ent), '💤');
  }

  function _setFacing(ent, dir) {
    if (dir === ent.facing) return;
    ent.facing = dir;
    ent.spriteEl.style.setProperty('--flip', dir);
  }

  function _moveToward(ent, speed, dt) {
    const dx = ent.target.x - ent.x;
    const dy = ent.target.y - ent.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= MOTION.ARRIVE_DISTANCE) return true;

    const step = Math.min(speed * dt, distance);
    ent.x += (dx / distance) * step;
    ent.y += (dy / distance) * step;
    if (Math.abs(dx) > 1) {
      _setFacing(ent, dx > 0 ? MOTION.FLIP_RIGHT : MOTION.FLIP_LEFT);
    }
    _renderPosition(ent);
    return false;
  }

  function _updateEnt(ent, dt, nowTs) {
    switch (ent.state) {
      case STATE.IDLE:
        if (nowTs >= ent.idleUntil) {
          if (Math.random() < ent.mods.napChance) _startNap(ent);
          else _startWander(ent);
        }
        break;
      case STATE.NAPPING:
        if (nowTs >= ent.napUntil) _setState(ent, STATE.IDLE);
        break;
      case STATE.WANDERING:
        if (_moveToward(ent, ent.mods.wanderSpeed, dt)) _setState(ent, STATE.IDLE);
        break;
      case STATE.SEEKING:
        if (!ent.food) {
          _setState(ent, STATE.IDLE);
          break;
        }
        ent.target = { x: ent.food.x, y: ent.food.y };
        if (Math.hypot(ent.food.x - ent.x, ent.food.y - ent.y) <= MOTION.EAT_DISTANCE ||
            _moveToward(ent, ent.mods.seekSpeed, dt)) {
          _startEating(ent);
        }
        break;
      case STATE.EATING:
        if (nowTs >= ent.eatUntil) _finishEating(ent);
        break;
    }
  }

  // ── 먹이 (다중 드롭 + 가까운 개체 점유) ────────────────

  /** 미점유 상추를 배고픈 가장 가까운 개체에게 배정 */
  function _assignFoods() {
    _foods.forEach(function (food) {
      if (food.claimedBy) return;
      let best = null;
      let bestDist = Infinity;
      _ents.forEach(function (ent) {
        if (!ent.hungry || ent.state === STATE.EATING || ent.food) return;
        const d = Math.hypot(food.x - ent.x, food.y - ent.y);
        if (d < bestDist) { bestDist = d; best = ent; }
      });
      if (best) {
        food.claimedBy = best.id;
        best.food = food;
        _setState(best, STATE.SEEKING);
      }
    });
  }

  /**
   * 서식지에 상추를 떨어뜨린다 — 터치/버튼 공용 단일 진입점.
   * 드롭 시점에는 사전 검증만 하고, 소모/효과 정산은 먹기 완료 시 GAME.feed()로 한다.
   */
  function dropFood(x, y) {
    const snails = DB.Snails.get().filter(function (s) { return s.stage !== 'egg'; });
    if (snails.length === 0) return;

    const player = DB.Player.get();
    if (_foods.length >= MOTION.FOOD_MAX) {
      Toast.show('상추가 이미 잔뜩 있어요! 먼저 먹게 해주세요.', 'warn');
      return;
    }
    if (!player.admin && player.food < _foods.length + 1) {
      // 이미 던져둔(아직 소모 전) 상추 수까지 감안한 재고 검증
      Toast.show(HomeModule.failMessage('no_food', player), 'warn');
      return;
    }
    if (!player.admin && !snails.some(function (s) { return s.hunger > 0; })) {
      Toast.show(HomeModule.failMessage('not_hungry', player), 'warn');
      return;
    }

    const p = _clampPoint(x, y, MOTION.EDGE_PADDING);
    const el = document.createElement('div');
    el.className = 'food-item';
    el.appendChild(document.getElementById('food-template').content.cloneNode(true));
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    _foodLayer().appendChild(el);

    _foods.push({ x: p.x, y: p.y, el: el, claimedBy: null });
    _assignFoods();
  }

  /** [먹이주기] 버튼용 — 서식지 안 임의 위치에 드롭 */
  function dropFoodRandom() {
    const b = _bounds();
    const edge = 30;
    dropFood(
      edge + Math.random() * Math.max(b.w - edge * 2, 1),
      edge + Math.random() * Math.max(b.h - edge * 2, 1)
    );
  }

  function _removeFood(food) {
    if (food.el) food.el.remove();
    _foods = _foods.filter(function (f) { return f !== food; });
  }

  function _startEating(ent) {
    ent.target = null;
    ent.eatUntil = performance.now() + MOTION.EAT_DURATION_MS;
    if (ent.food && ent.food.el) ent.food.el.classList.add('eaten');
    _setState(ent, STATE.EATING);
  }

  /** 먹기 완료 — 해당 개체에만 GAME.feed()로 정산 */
  function _finishEating(ent) {
    if (ent.food) {
      _removeFood(ent.food);
      ent.food = null;
    }
    const rec = DB.Snails.getById(ent.id);
    if (!rec) { _setState(ent, STATE.IDLE); return; }

    const result = GAME.feed(rec, DB.Player.get());
    HomeModule.handleResult(result);
    if (result.events.indexOf('fed') !== -1) {
      _floatAt(ent.x, ent.y - _edge(ent), '+' + GAME.CONFIG.FEED_EXP + ' EXP');
      Sound.play('eat');
      const rect = _habitat().getBoundingClientRect();
      FX.flyCoins(rect.left + ent.x, rect.top + ent.y, 2);
    }
    ent.hungry = result.snail.hunger > 0 || _adminOn;
    _setState(ent, STATE.IDLE);
    _assignFoods(); // 남은 상추 재배정
  }

  // ── 장식 ──────────────────────────────────────────────

  function renderDecorations() {
    const layer = document.getElementById('deco-layer');
    layer.innerHTML = '';

    const player = DB.Player.get();
    const slots = (player.decorations && player.decorations.slots) || [];
    slots.forEach(function (id, i) {
      if (!id) return;
      const template = document.getElementById('deco-' + id);
      if (!template) return;
      const el = document.createElement('div');
      el.className = 'deco-item';
      el.style.left = DECO_SLOTS[i].x;
      el.style.top = DECO_SLOTS[i].y;
      el.appendChild(template.content.cloneNode(true));
      layer.appendChild(el);
    });
  }

  // ── 이펙트 ────────────────────────────────────────────

  function _floatAt(x, y, text) {
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    _habitat().appendChild(el);
    setTimeout(function () { el.remove(); }, 1200);
  }

  /** 특정 개체(또는 첫 개체) 머리 위 이펙트 */
  function effect(text, entId) {
    const ent = _ents.find(function (e) { return e.id === entId; }) || _ents[0];
    if (!ent) return;
    _floatAt(ent.x, ent.y - _edge(ent), text);
  }

  // ── 게임 루프 ─────────────────────────────────────────

  function _loop(ts) {
    if (!_running) return;
    if (_lastTs === null) _lastTs = ts;
    const dt = Math.min((ts - _lastTs) / 1000, 0.1);
    _lastTs = ts;

    _assignFoods();
    _ents.forEach(function (ent) { _updateEnt(ent, dt, ts); });
    _rafId = requestAnimationFrame(_loop);
  }

  function _canRun() {
    return _ents.length > 0 &&
      document.getElementById('screen-home').classList.contains('active') &&
      !document.hidden;
  }

  function pause() {
    _running = false;
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = null;
    _lastTs = null;
  }

  function resume() {
    if (_running || !_canRun()) return;
    _running = true;
    _rafId = requestAnimationFrame(_loop);
  }

  // ── 라이프사이클 ──────────────────────────────────────

  function _onResize() {
    _ents.forEach(function (ent) {
      const p = _clampPoint(ent.x, ent.y, _edge(ent));
      ent.x = p.x;
      ent.y = p.y;
      _renderPosition(ent);
    });
  }

  function init() {
    window.addEventListener('resize', _onResize);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause();
      else resume();
    });

    // 서식지 터치: 달팽이 근처면 쓰다듬기, 빈 곳이면 먹이 드롭
    _habitat().addEventListener('pointerdown', function (e) {
      const rect = _habitat().getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      let nearest = null;
      let nearestDist = Infinity;
      _ents.forEach(function (ent) {
        const d = Math.hypot(x - ent.x, y - ent.y);
        if (d < nearestDist) { nearestDist = d; nearest = ent; }
      });
      if (nearest && nearestDist <= Math.max(_edge(nearest), MOTION.PET_RADIUS_MIN)) {
        if (nearest.state === STATE.NAPPING) _setState(nearest, STATE.IDLE); // 쓰다듬으면 깬다
        HomeModule.handlePet(nearest.id);
        return;
      }
      dropFood(x, y);
    });

    renderDecorations();
    sync();
  }

  return {
    MOTION: MOTION,
    init: init,
    sync: sync,
    pause: pause,
    resume: resume,
    dropFood: dropFood,
    dropFoodRandom: dropFoodRandom,
    effect: effect,
    renderDecorations: renderDecorations,
    /** QA/디버그용 현재 상태 */
    debugState: function () {
      return {
        running: _running,
        foods: _foods.length,
        ents: _ents.map(function (e) {
          return { id: e.id, state: e.state, x: e.x, y: e.y };
        })
      };
    }
  };
})();
