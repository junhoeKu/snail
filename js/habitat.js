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
    DRAG_THRESHOLD_PX: 8, // 이 거리 미만 = 탭(팝업), 이상 = 드래그(옮기기)
    LONGPRESS_MS: 420,    // 이 시간 이상 누르고 있으면 연속 쓰다듬기 (연출 전용)
    LONGPRESS_HEART_MS: 550, // 누르는 동안 하트 간격
    TRAIL_STEP_PX: 26,    // 이동 누적 N px마다 점액 자국 1점
    TRAIL_LIFE_MS: 6000,  // 점액 자국 수명
    TRAIL_MAX: 40,        // 동시 점액 자국 상한 (성능 가드)
    FLIP_RIGHT: -1,       // 스프라이트가 왼쪽을 보므로 오른쪽 이동 시 반전
    FLIP_LEFT: 1
  };

  const STATE = {
    IDLE: 'idle',
    WANDERING: 'wandering',
    SEEKING: 'seeking_food',
    EATING: 'eating',
    NAPPING: 'napping',
    RESTING: 'resting',        // 앵커 휴식
    SOCIALIZING: 'socializing', // 동료에게 다가가 인사
    WATCHING: 'watching',       // 먹는 동료 구경
    DRAGGING: 'dragging'        // 사용자가 집어서 옮기는 중 (루프 제외)
  };

  // 행동 선택기(Behavior Director) 수치 — 전부 연출 계층 (GAME.CONFIG 아님, 11차 §2)
  const BEHAVIOR = {
    BASE: { wander: 40, nap: 10, rest: 20, socialize: 15, watch: 0 },
    REST_MIN_MS: 8000,
    REST_MAX_MS: 20000,
    SOCIAL_COOLDOWN_MS: 90000,
    GREET_MS: 1500,
    EMOTE_MS: 2500,
    EMOTE_INTERVAL_MS: 4000,   // resting/napping/idle 중 간헐 이모트 간격
    BUDDY_GREETS: 3            // 세션 내 인사 누적 N회 → 단짝 연출 (💞·같이 쉬기 확률↑)
  };

  function _isNight() {
    const h = new Date().getHours();
    return h >= 22 || h < 7;
  }

  // 행동 선택 rng — 테스트에서 주입 가능(결정적)
  let _rng = Math.random;
  function setBehaviorRng(fn) { _rng = fn || Math.random; }

  // 알 오브젝트 배치 지점 (% 좌표) — 최대 8슬롯 (11차 §6)
  const EGG_SPOTS = [
    { x: '20%', y: '76%' },
    { x: '38%', y: '82%' },
    { x: '56%', y: '80%' },
    { x: '74%', y: '76%' },
    { x: '28%', y: '90%' },
    { x: '48%', y: '92%' },
    { x: '66%', y: '90%' },
    { x: '84%', y: '84%' }
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

    // 머리 위 스탯 배지 (배고픔/행복)
    const badge = document.createElement('div');
    badge.className = 'snail-badge';
    const hungerSpan = document.createElement('span');
    hungerSpan.className = 'b-hunger';
    const happySpan = document.createElement('span');
    happySpan.className = 'b-happy';
    badge.appendChild(hungerSpan);
    badge.appendChild(happySpan);
    root.appendChild(badge);

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

  /** 변이/단계/컨디션 반영 (일러스트 스프라이트 교체) — 단계는 표시용(skin) 우선 */
  function _applyLook(ent, rec) {
    const condition = GAME.conditionOf(rec);
    const color = GAME.VARIANTS[rec.color] ? rec.color : 'brown'; // 무효 변이 방어
    const stage = GAME.displayStage(rec);
    ent.spriteEl.className = 'snail-sprite stage-' + stage +
      ' variant-' + color +
      (condition.id !== 'normal' ? ' cond-' + condition.id : '');

    const img = ent.spriteEl.querySelector('.snail-img');
    const src = GAME.spritePath(color, stage);
    if (img && img.getAttribute('src') !== src) img.setAttribute('src', src);

    // 머리 위 배지 갱신
    const hungerSpan = ent.root.querySelector('.b-hunger');
    const happySpan = ent.root.querySelector('.b-happy');
    if (hungerSpan) hungerSpan.textContent = '🍀' + rec.hunger;
    if (happySpan) happySpan.textContent = '😊' + rec.happiness;
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
    const weather = GAME.WEATHER[GAME.weatherFor(DB.today(), new Date().getHours())];
    const condition = GAME.conditionOf(rec);
    const personality = GAME.PERSONALITIES[rec.personality] ||
      { seekFactor: 1, speedFactor: 1, idleFactor: 1, napFactor: 1, napLenFactor: 1, eatFactor: 1 };

    const speed = weather.speedFactor * condition.speedFactor * personality.speedFactor;
    ent.mods = {
      wanderSpeed: MOTION.WANDER_SPEED * speed,
      seekSpeed: MOTION.SEEK_SPEED * speed * personality.seekFactor,
      idleFactor: weather.idleFactor * personality.idleFactor,
      napChance: MOTION.NAP_CHANCE * personality.napFactor,
      napLenFactor: personality.napLenFactor,
      eatFactor: personality.eatFactor
    };
    _applyLook(ent, rec);
  }

  function _setState(ent, next) {
    ent.state = next;
    ent.root.className = 'snail-entity state-' + next;
    _computeMods(ent);

    if (next === STATE.IDLE) {
      ent.target = null;
      ent.pending = null;
      ent.idleUntil = performance.now() +
        (MOTION.IDLE_MIN_MS + Math.random() * (MOTION.IDLE_MAX_MS - MOTION.IDLE_MIN_MS)) * ent.mods.idleFactor;
      const p = _clampPoint(ent.x, ent.y, _edge(ent));
      ent.x = p.x;
      ent.y = p.y;
      _renderPosition(ent);
      _savePosition(ent);
    }
  }

  /** px → 0~1 비율 좌표 (소수 3자리) — 위치/드롭 저장 공용 포맷 */
  function _toRatio(x, y) {
    const b = _bounds();
    if (!b.w || !b.h) return null;
    return {
      rx: Math.round((x / b.w) * 1000) / 1000,
      ry: Math.round((y / b.h) * 1000) / 1000
    };
  }

  function _savePosition(ent) {
    const ratio = _toRatio(ent.x, ent.y);
    if (!ratio) return;
    const rec = DB.Snails.getById(ent.id);
    if (!rec) return;
    rec.pos = ratio;
    DB.Snails.saveOne(rec);
  }

  /** 서식지 안 무작위 지점 — 배회/낮잠/휴식 목적지 공용 (특정 좌표 몰림 방지) */
  function _randomPoint(edge) {
    const b = _bounds();
    return _clampPoint(
      edge + _rng() * Math.max(b.w - edge * 2, 1),
      edge + _rng() * Math.max(b.h - edge * 2, 1),
      edge
    );
  }

  function _startWander(ent) {
    ent.target = _randomPoint(_edge(ent));
    _setState(ent, STATE.WANDERING);
  }

  function _startNapHere(ent) {
    ent.target = null;
    ent.napUntil = performance.now() +
      (MOTION.NAP_MIN_MS + _rng() * (MOTION.NAP_MAX_MS - MOTION.NAP_MIN_MS)) *
      (ent.mods.napLenFactor || 1);
    _setState(ent, STATE.NAPPING);
    _emote(ent, '💤');
  }

  // ── 이모트 잔류 버블 ───────────────────────────────────

  function _emote(ent, text) {
    const el = document.createElement('div');
    el.className = 'snail-emote';
    el.textContent = text;
    el.style.left = ent.x + 'px';
    el.style.top = (ent.y - _edge(ent) - 6) + 'px';
    _habitat().appendChild(el);
    setTimeout(function () { el.remove(); }, BEHAVIOR.EMOTE_MS);
  }

  // ── 행동 선택기 (idle 만료 시) ─────────────────────────

  function _chooseBehavior(ent) {
    const rec = DB.Snails.getById(ent.id);
    if (!rec) { _startWander(ent); return; }
    const night = _isNight();
    const weather = GAME.WEATHER[GAME.weatherFor(DB.today(), new Date().getHours())] || { id: 'sunny' };
    const rain = weather.id === 'rain';
    const per = rec.personality;
    const now = performance.now();
    const peers = _ents.filter(function (e) {
      return e !== ent && e.state !== STATE.EATING && DB.Snails.getById(e.id);
    });
    const eatingPeer = _ents.find(function (e) { return e !== ent && e.state === STATE.EATING; });
    const canSocial = !ent.socialUntil || now >= ent.socialUntil;

    const w = {
      wander: BEHAVIOR.BASE.wander * (per === 'explorer' ? 2 : 1) * (rain ? 1.5 : 1) * (night ? 0.3 : 1),
      nap: BEHAVIOR.BASE.nap * (per === 'sleepy' ? 3 : 1) * (night ? 5 : 1) * (rain ? 1.3 : 1),
      rest: BEHAVIOR.BASE.rest * (rec.hunger < 20 ? 1.5 : 1),
      socialize: (canSocial && peers.length) ? BEHAVIOR.BASE.socialize * (per === 'explorer' ? 1.5 : 1) : 0,
      watch: (canSocial && eatingPeer) ? 25 * (per === 'foodie' ? 2 : 1) : 0
    };
    const total = w.wander + w.nap + w.rest + w.socialize + w.watch;
    let r = _rng() * total;
    if ((r -= w.wander) < 0) return _startWander(ent);
    if ((r -= w.nap) < 0) return _startAnchorNap(ent);
    if ((r -= w.rest) < 0) return _startRest(ent);
    if ((r -= w.socialize) < 0) return _startSocialize(ent, peers);
    return _startWatch(ent, eatingPeer);
  }

  /** 앵커로 이동 후 nap/rest 시작 — 이동 자체가 디오라마. WANDERING pending으로 처리 */
  /** 무작위 지점으로 이동 후 nap 시작 — 이동 자체가 디오라마. WANDERING pending으로 처리 */
  function _startAnchorNap(ent) {
    ent.target = _randomPoint(_edge(ent));
    ent.pending = 'nap';
    _setState(ent, STATE.WANDERING);
  }

  function _startRest(ent) {
    ent.target = _randomPoint(_edge(ent));
    ent.pending = 'rest';
    _setState(ent, STATE.WANDERING);
  }

  function _beginNap(ent) {
    const rain = (GAME.WEATHER[GAME.weatherFor(DB.today(), new Date().getHours())] || {}).id === 'rain';
    ent.napUntil = performance.now() +
      (MOTION.NAP_MIN_MS + _rng() * (MOTION.NAP_MAX_MS - MOTION.NAP_MIN_MS)) * (ent.mods.napLenFactor || 1);
    ent.emoteNext = performance.now() + BEHAVIOR.EMOTE_INTERVAL_MS;
    _setState(ent, STATE.NAPPING);
    _emote(ent, rain ? '☔' : '💤');
  }

  function _beginRest(ent) {
    ent.restUntil = performance.now() + (BEHAVIOR.REST_MIN_MS + _rng() * (BEHAVIOR.REST_MAX_MS - BEHAVIOR.REST_MIN_MS));
    ent.emoteNext = performance.now() + BEHAVIOR.EMOTE_INTERVAL_MS;
    _setState(ent, STATE.RESTING);
  }

  // ── 사회 행동 ──────────────────────────────────────────

  function _startSocialize(ent, peers) {
    let best = null, bd = Infinity;
    peers.forEach(function (p) {
      const d = Math.hypot(p.x - ent.x, p.y - ent.y);
      if (d < bd) { bd = d; best = p; }
    });
    if (!best) { _startWander(ent); return; }
    ent.socialTarget = best.id;
    ent.target = { x: best.x + (ent.x < best.x ? -34 : 34), y: best.y };
    ent.pending = 'socialize';
    ent.socialUntil = performance.now() + BEHAVIOR.SOCIAL_COOLDOWN_MS;
    _setState(ent, STATE.WANDERING);
  }

  // 단짝 (Phase 5) — 세션 내 인사 횟수 누적 (연출 전용, 저장 없음)
  const _buddyGreets = {};

  function _pairKey(a, b) {
    return a < b ? a + '|' + b : b + '|' + a;
  }

  function _isBuddy(a, b) {
    return (_buddyGreets[_pairKey(a, b)] || 0) >= BEHAVIOR.BUDDY_GREETS;
  }

  function _beginGreet(ent) {
    const target = _ents.find(function (e) { return e.id === ent.socialTarget; });
    if (!target || target.state === STATE.EATING) { _setState(ent, STATE.IDLE); return; }
    _setState(ent, STATE.SOCIALIZING);
    ent.greetUntil = performance.now() + BEHAVIOR.GREET_MS;
    const key = _pairKey(ent.id, target.id);
    _buddyGreets[key] = (_buddyGreets[key] || 0) + 1;
    const heart = _isBuddy(ent.id, target.id) ? '💞' : '💕'; // 단짝은 더 진한 하트
    _emote(ent, heart);
    _emote(target, heart);
  }

  function _startWatch(ent, eatingPeer) {
    if (!eatingPeer) { _startWander(ent); return; }
    ent.watchTarget = eatingPeer.id;
    ent.target = { x: eatingPeer.x + (ent.x < eatingPeer.x ? -30 : 30), y: eatingPeer.y };
    ent.pending = 'watch';
    ent.socialUntil = performance.now() + BEHAVIOR.SOCIAL_COOLDOWN_MS;
    _setState(ent, STATE.WANDERING);
  }

  function _beginWatch(ent) {
    const t = _ents.find(function (e) { return e.id === ent.watchTarget; });
    if (!t || t.state !== STATE.EATING) { _setState(ent, STATE.IDLE); return; }
    _setState(ent, STATE.WATCHING);
    _emote(ent, '👀');
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
    ent.trailAcc = (ent.trailAcc || 0) + step; // 점액 자국 (Phase 5)
    if (ent.trailAcc >= MOTION.TRAIL_STEP_PX) {
      ent.trailAcc = 0;
      _dropTrail(ent);
    }
    _renderPosition(ent);
    return false;
  }

  function _emoteTick(ent, nowTs, text, chance) {
    if (nowTs >= (ent.emoteNext || 0)) {
      ent.emoteNext = nowTs + BEHAVIOR.EMOTE_INTERVAL_MS;
      if (_rng() < chance) _emote(ent, text);
    }
  }

  /**
   * 유휴 생활감 (Phase 5) — 컨디션 표정(배고픔 🥺 / 행복 ✨)과
   * 이따금의 하품·두리번 모션. 전부 연출 전용.
   */
  function _idleLife(ent, nowTs) {
    if (nowTs < (ent.emoteNext || 0)) return;
    ent.emoteNext = nowTs + BEHAVIOR.EMOTE_INTERVAL_MS;

    const rec = DB.Snails.getById(ent.id);
    if (!rec) return;
    const condition = GAME.conditionOf(rec);
    if (condition.id === 'hungry') {
      if (_rng() < 0.45) _emote(ent, '🥺');
      return;
    }
    if (condition.id === 'happy' && _rng() < 0.3) {
      _emote(ent, '✨');
      return;
    }
    const r = _rng();
    if (r < 0.14) { // 하품
      _emote(ent, '🥱');
      _peek(ent);
    } else if (r < 0.3) { // 두리번
      _peek(ent);
    }
  }

  /** 두리번/기지개 — motion 레이어에 잠깐 peek 애니메이션 */
  function _peek(ent) {
    const motion = ent.root.querySelector('.snail-motion');
    if (!motion) return;
    motion.classList.add('peek');
    setTimeout(function () { motion.classList.remove('peek'); }, 1300);
  }

  // ── 점액 트레일 (Phase 5 — 이동 흔적, 연출 전용) ───────

  let _trailCount = 0;

  function _dropTrail(ent) {
    if (_trailCount >= MOTION.TRAIL_MAX) return;
    const el = document.createElement('div');
    el.className = 'slime-dot';
    el.style.left = ent.x + 'px';
    el.style.top = (ent.y + _edge(ent) * 0.4) + 'px';
    _habitat().appendChild(el);
    _trailCount++;
    setTimeout(function () {
      el.remove();
      _trailCount--;
    }, MOTION.TRAIL_LIFE_MS);
  }

  function _updateEnt(ent, dt, nowTs) {
    switch (ent.state) {
      case STATE.IDLE:
        if (nowTs >= ent.idleUntil) _chooseBehavior(ent);
        else _idleLife(ent, nowTs); // 표정/하품/두리번 (Phase 5)
        break;
      case STATE.NAPPING:
        if (nowTs >= ent.napUntil) _setState(ent, STATE.IDLE);
        else _emoteTick(ent, nowTs, '💤', 0.5);
        break;
      case STATE.RESTING:
        if (nowTs >= ent.restUntil) _setState(ent, STATE.IDLE);
        else _emoteTick(ent, nowTs, '🎵', 0.4);
        break;
      case STATE.SOCIALIZING:
        if (nowTs >= ent.greetUntil) {
          // 단짝(세션 인사 3회+)은 거의 항상 같이 쉰다
          const together = _isBuddy(ent.id, ent.socialTarget || '') ? 0.9 : 0.6;
          if (_rng() < together) _startRest(ent);
          else _setState(ent, STATE.IDLE);
        }
        break;
      case STATE.WATCHING: {
        const wt = _ents.find(function (e) { return e.id === ent.watchTarget; });
        if (!wt || wt.state !== STATE.EATING) { // 대상 식사 끝
          if (_rng() < 0.5) _startRest(ent);
          else _setState(ent, STATE.IDLE);
        }
        break;
      }
      case STATE.WANDERING:
        if (_moveToward(ent, ent.mods.wanderSpeed, dt)) {
          const pend = ent.pending;
          ent.pending = null;
          if (pend === 'nap') _beginNap(ent);
          else if (pend === 'rest') _beginRest(ent);
          else if (pend === 'socialize') _beginGreet(ent);
          else if (pend === 'watch') _beginWatch(ent);
          else _setState(ent, STATE.IDLE);
        }
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
      case STATE.DRAGGING:
        break; // 위치는 포인터가 결정 — 루프는 손대지 않는다
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
        if (!ent.hungry || ent.state === STATE.EATING || ent.state === STATE.DRAGGING || ent.food) return;
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

  /** 필드에 먹이 요소를 만든다 — 드롭/복원 공용 (검증·저장 없음) */
  function _placeFood(x, y, fid, dropId) {
    const templateId = fid === 'lettuce' ? 'food-template' : 'food-' + fid;
    const template = document.getElementById(templateId);
    if (!template) return null; // 알 수 없는 먹이 방어 (복원 데이터)

    const p = _clampPoint(x, y, MOTION.EDGE_PADDING);
    const el = document.createElement('div');
    el.className = 'food-item';
    el.appendChild(template.content.cloneNode(true));
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    _foodLayer().appendChild(el);

    const food = { x: p.x, y: p.y, el: el, claimedBy: null, foodId: fid, dropId: dropId };
    _foods.push(food);
    return food;
  }

  /** 서버가 드롭을 거절(재고/상한)했을 때 — 화면에서도 거둬 상태를 일치시킨다 */
  function _discardFood(food, message) {
    _ents.forEach(function (ent) {
      if (ent.food === food) {
        ent.food = null;
        _setState(ent, STATE.IDLE);
      }
    });
    _removeFood(food);
    if (message) Toast.show(message, 'warn');
  }

  /** 드롭을 저장한다 — 재접속 시 이어 먹기 (서버 모드=서버 기록, 로컬 모드=DB.Player) */
  function _persistDrop(food, player) {
    const ratio = _toRatio(food.x, food.y) || { rx: 0.5, ry: 0.5 };

    if (Api.enabled()) {
      // 등록 완료 전에 먹기가 끝나면 순서가 뒤집힐 수 있어 promise를 남긴다 (_finishEating이 대기)
      food.persistPromise = Api.dropFood({ id: food.dropId, foodId: food.foodId, rx: ratio.rx, ry: ratio.ry })
        .catch(function (err) {
          if (err && err.code === 'network') return; // 오프라인 — 이번 세션 연출 유지
          // 도메인 거절(다른 기기 소비 등 미러 불일치) — 화면 상태를 서버에 맞춘다
          _discardFood(food, (err && err.message) || '먹이를 놓을 수 없어요.');
        });
      return;
    }
    player.dropped_foods = (player.dropped_foods || []).concat({
      id: food.dropId, food_id: food.foodId, rx: ratio.rx, ry: ratio.ry, dropped_at: DB.now()
    });
    DB.Player.save(player);
  }

  /** 저장된 드롭 제거 (로컬 모드 전용 — 서버 모드는 feed(dropId)가 서버에서 지운다) */
  function _unpersistDrop(food) {
    if (!food.dropId || Api.enabled()) return;
    const player = DB.Player.get();
    player.dropped_foods = (player.dropped_foods || []).filter(function (d) {
      return d.id !== food.dropId;
    });
    DB.Player.save(player);
  }

  /**
   * 저장된 드롭 먹이 복원 (부팅 시 1회) — 이어 먹기는 _assignFoods가 자동 처리.
   * TTL(FIELD_FOOD_TTL_HOURS)이 지난 항목은 걸러낸다 (소모가 아니라 재고 무변동).
   */
  function restoreDrops() {
    if (_foods.length) return;
    const player = DB.Player.get();
    const drops = player.dropped_foods || [];
    if (!drops.length) return;

    const alive = GAME.pruneDroppedFoods(drops);
    const b = _bounds();
    alive.slice(0, GAME.CONFIG.FIELD_FOOD_MAX).forEach(function (d) {
      _placeFood((d.rx || 0.5) * b.w, (d.ry || 0.5) * b.h, d.food_id || 'lettuce', d.id);
    });
    if (!Api.enabled() && alive.length !== drops.length) { // 로컬 모드: TTL 만료분 정리
      player.dropped_foods = alive;
      DB.Player.save(player);
    }
    _assignFoods();
  }

  /**
   * 서식지에 상추를 떨어뜨린다 — 터치/버튼 공용 단일 진입점.
   * 드롭 시점에는 사전 검증만 하고, 소모/효과 정산은 먹기 완료 시 GAME.feed()로 한다.
   */
  function dropFood(x, y, foodId) {
    const snails = DB.Snails.get().filter(function (s) { return s.stage !== 'egg'; });
    if (snails.length === 0) return;

    const player = DB.Player.get();
    const fid = foodId || player.selected_food || 'lettuce';

    if (_foods.length >= GAME.CONFIG.FIELD_FOOD_MAX) {
      Toast.show('먹이가 이미 잔뜩 있어요! 먼저 먹게 해주세요.', 'warn');
      return;
    }
    // 이미 던져둔(아직 소모 전) 같은 먹이 수까지 감안한 재고 검증
    const pendingSame = _foods.filter(function (f) { return f.foodId === fid; }).length;
    if (!player.admin && ((player.foods && player.foods[fid]) || 0) < pendingSame + 1) {
      Toast.show(HomeModule.failMessage('no_food', player), 'warn');
      return;
    }
    if (!player.admin && !snails.some(function (s) { return s.hunger > 0; })) {
      Toast.show(HomeModule.failMessage('not_hungry', player), 'warn');
      return;
    }

    const food = _placeFood(x, y, fid, Api.requestId());
    if (!food) { // 템플릿 없는 먹이 (구버전 캐시 등) — 조용히 죽지 않는다
      Toast.show('알 수 없는 먹이예요. 앱을 새로고침해 주세요.', 'warn');
      return;
    }
    _persistDrop(food, player);
    _assignFoods();
  }

  /** 개체 팝업의 [먹이주기] — 그 달팽이 근처에 드롭 */
  function dropFoodNear(snailId) {
    const ent = _ents.find(function (e) { return e.id === snailId; });
    if (!ent) return;
    const angle = Math.random() * Math.PI * 2;
    dropFood(ent.x + Math.cos(angle) * 44, ent.y + Math.sin(angle) * 44);
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
    _unpersistDrop(food);
  }

  function _startEating(ent) {
    ent.target = null;
    ent.eatUntil = performance.now() + MOTION.EAT_DURATION_MS * (ent.mods.eatFactor || 1);
    if (ent.food && ent.food.el) ent.food.el.classList.add('eaten');
    _setState(ent, STATE.EATING);
  }

  /** 먹기 완료 — 해당 개체에만 GAME.feed()로 정산 */
  function _finishEating(ent) {
    let foodId = null;
    let dropId = null;
    let persistPromise = null;
    if (ent.food) {
      foodId = ent.food.foodId;
      dropId = ent.food.dropId || null;
      persistPromise = ent.food.persistPromise || null;
      _removeFood(ent.food);
      ent.food = null;
    }
    const rec = DB.Snails.getById(ent.id);
    if (!rec) { _setState(ent, STATE.IDLE); return; }

    if (Api.enabled()) {
      // 서버 판정 — 연출은 즉시, 수치는 응답으로 반영 (dropId로 서버 드롭 기록도 정리)
      Sound.play('eat');
      const habitatRect = _habitat().getBoundingClientRect();
      FX.flyCoins(habitatRect.left + ent.x, habitatRect.top + ent.y, 2);
      const entX = ent.x, entY = ent.y, edge = _edge(ent);
      // 드롭 등록이 아직 비행 중이면 완료를 기다린다 — feed가 먼저 닿아 삭제가 헛돌면
      // 늦게 도착한 등록이 이미 먹힌 드롭을 되살린다 (등록 실패는 내부 catch로 이미 처리됨)
      Promise.resolve(persistPromise).then(function () {
        return Api.feed(ent.id, foodId, null, dropId);
      }).then(function (res) {
        Api.Net.apply(res);
        const fed = (res.events || []).find(function (e) { return e.type === 'fed'; });
        if (fed) _floatAt(entX, entY - edge, '+' + fed.exp + ' EXP');
        const fresh = DB.Snails.getById(ent.id);
        ent.hungry = !!fresh && fresh.hunger > 0;
      }).catch(function (err) {
        if (err && err.code === 'network') {
          Api.queueFeed(ent.id, foodId, dropId);
          const fresh = DB.Snails.getById(ent.id);
          ent.hungry = !!fresh && fresh.hunger > 0;
        } else {
          // 도메인 거절 — 서버에 남은 드롭 기록을 정리해 다음 부팅의 유령 복원을 막는다
          if (dropId) Api.removeDrop(dropId).catch(function () { /* TTL이 최후 안전망 */ });
          Api.Net.fail(err);
        }
      });
      _setState(ent, STATE.IDLE);
      _assignFoods();
      return;
    }

    const result = GAME.feed(rec, DB.Player.get(), foodId);
    HomeModule.handleResult(result);
    if (result.events.indexOf('fed') !== -1) {
      _floatAt(ent.x, ent.y - _edge(ent), '+' + result.food.exp + ' EXP');
      Sound.play('eat');
      const rect = _habitat().getBoundingClientRect();
      FX.flyCoins(rect.left + ent.x, rect.top + ent.y, 2);
      App.gainKeeperXp('feed');
    }
    ent.hungry = result.snail.hunger > 0 || _adminOn;
    _setState(ent, STATE.IDLE);
    _assignFoods(); // 남은 먹이 재배정
  }

  // ── 방문객 (연출 전용 — 14차 Phase 4) ─────────────────
  // 낮: 나비/무당벌레, 밤(연출 밤 기준): 반딧불이. 게임 수치 무영향, 화면을 가로질러 사라진다.

  const VISITORS = {
    butterfly: { src: 'assets/visitors/visitor_butterfly.png', size: 36, duration: 14000, band: [0.15, 0.45], cls: 'visitor-butterfly' },
    ladybug: { src: 'assets/visitors/visitor_ladybug.png', size: 24, duration: 20000, band: [0.78, 0.9], cls: 'visitor-ladybug' },
    firefly: { src: 'assets/visitors/visitor_firefly.png', size: 18, duration: 16000, band: [0.2, 0.6], cls: 'visitor-firefly' }
  };
  const VISITOR_CHECK_MS = 45000; // 45초마다 방문 판정
  const VISITOR_CHANCE = 0.35;
  let _visitorTimer = null;
  let _visitorBusy = false; // 동시 1마리 (성능/소란 가드)

  function _spawnVisitor() {
    const b = _bounds();
    if (!b.w || _visitorBusy) return;
    const pool = _isNight() ? ['firefly'] : ['butterfly', 'ladybug'];
    const def = VISITORS[pool[Math.floor(_rng() * pool.length)]];

    const el = document.createElement('img');
    el.className = 'visitor ' + def.cls;
    el.src = def.src;
    el.alt = '';
    el.style.width = def.size + 'px';
    const fromLeft = _rng() < 0.5;
    el.style.top = ((def.band[0] + _rng() * (def.band[1] - def.band[0])) * b.h) + 'px';
    el.style.left = (fromLeft ? -def.size : b.w + def.size) + 'px';
    el.style.setProperty('--vflip', fromLeft ? -1 : 1); // 스프라이트는 왼쪽을 본다
    _habitat().appendChild(el);

    _visitorBusy = true;
    requestAnimationFrame(function () {
      el.style.transition = 'left ' + def.duration + 'ms linear';
      el.style.left = (fromLeft ? b.w + def.size : -def.size * 2) + 'px';
    });
    setTimeout(function () {
      el.remove();
      _visitorBusy = false;
    }, def.duration + 500);
  }

  function _startVisitors() {
    if (_visitorTimer) return;
    _visitorTimer = setInterval(function () {
      if (!_running) return; // 홈 화면 + 보이는 탭일 때만
      if (_rng() < VISITOR_CHANCE) _spawnVisitor();
    }, VISITOR_CHECK_MS);
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

  /** 복귀 장면 배치 — 생활 시뮬 문장과 화면을 일치시킨다 (11차 §5.2) */
  function applyScene(scene) {
    (scene || []).forEach(function (item) {
      const ent = _ents.find(function (e) { return e.id === item.id; });
      if (!ent) return;
      // 식사 중(추적/먹기)이거나 사용자가 집고 있는 개체는 장면 배치로 방해하지 않는다
      if (ent.state === STATE.SEEKING || ent.state === STATE.EATING ||
          ent.state === STATE.DRAGGING) return;
      const p = _randomPoint(_edge(ent)); // 복귀 장면도 무작위 지점 (몰림 방지)
      ent.x = p.x;
      ent.y = p.y;
      _renderPosition(ent);
      if (item.state === 'napping') _beginNap(ent);
      else _beginRest(ent);
    });
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

  // ── 포인터 제스처: 탭(팝업/먹이 드롭) vs 드래그(달팽이 옮기기) ──

  // { ent, pointerId, startX, startY, moved, rect, edge } — 단일 활성 제스처.
  // rect/edge는 드래그 동안 불변이라 pointerdown에서 캡처한다 (move마다 강제 레이아웃 방지)
  let _drag = null;

  function _onPointerDown(e) {
    // 이미 드래그 중이거나 보조 포인터(두 번째 손가락)면 무시 — 드롭/팝업 오발 방지
    if (_drag || e.isPrimary === false) return;

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
      // 탭인지 드래그인지는 이동 거리(DRAG_THRESHOLD_PX)로 pointerup에서 판정
      _drag = { ent: nearest, pointerId: e.pointerId, startX: x, startY: y, moved: false,
                rect: rect, edge: _edge(nearest) };
      // 움직이지 않고 오래 누르면 연속 쓰다듬기 (Phase 5 — 연출 전용)
      _drag.holdTimer = setTimeout(_beginHold, MOTION.LONGPRESS_MS);
      if (_habitat().setPointerCapture && e.pointerId !== undefined) {
        try { _habitat().setPointerCapture(e.pointerId); } catch (err) { /* 미지원 무시 */ }
      }
      return;
    }
    dropFood(x, y);
  }

  /** 롱프레스 시작 — 누르는 동안 하트가 이어진다 (pet 판정은 팝업 버튼 경로 그대로) */
  function _beginHold() {
    if (!_drag || _drag.moved) return;
    _drag.holding = true;
    const ent = _drag.ent;
    if (ent.state === STATE.NAPPING) _setState(ent, STATE.IDLE); // 쓰다듬으면 깬다
    Sound.play('heart');
    _emote(ent, '💗');
    _drag.heartTimer = setInterval(function () {
      if (!_drag || !_drag.holding) return;
      _emote(_drag.ent, _rng() < 0.5 ? '💗' : '💕');
    }, MOTION.LONGPRESS_HEART_MS);
  }

  function _onPointerMove(e) {
    if (!_drag || e.pointerId !== _drag.pointerId) return;
    const ent = _drag.ent;
    const x = e.clientX - _drag.rect.left;
    const y = e.clientY - _drag.rect.top;

    if (!_drag.moved) {
      if (Math.hypot(x - _drag.startX, y - _drag.startY) < MOTION.DRAG_THRESHOLD_PX) return;
      _stopHold(_drag); // 움직이면 쓰다듬기 종료 → 드래그로 전환
      if (ent.state === STATE.EATING) { _drag = null; return; } // 식사는 방해하지 않는다 — 스와이프는 무효(탭 아님)
      _drag.moved = true; // 드래그 시작 — 집힌 개체는 루프에서 제외
      if (ent.food) { ent.food.claimedBy = null; ent.food = null; } // 점유 먹이 반납 (재배정)
      _setState(ent, STATE.DRAGGING);
      _emote(ent, '💦'); // 놀람
    }

    const c = _clampPoint(x, y, _drag.edge);
    ent.x = c.x;
    ent.y = c.y;
    _renderPosition(ent);
  }

  function _stopHold(drag) {
    if (drag.holdTimer) clearTimeout(drag.holdTimer);
    if (drag.heartTimer) clearInterval(drag.heartTimer);
    drag.holdTimer = null;
    drag.heartTimer = null;
  }

  function _releaseDrag(e) {
    if (!_drag || e.pointerId !== _drag.pointerId) return null;
    const drag = _drag;
    _drag = null;
    _stopHold(drag);
    if (_habitat().releasePointerCapture && drag.pointerId !== undefined) {
      try { _habitat().releasePointerCapture(drag.pointerId); } catch (err) { /* 무시 */ }
    }
    return drag;
  }

  function _onPointerUp(e) {
    const drag = _releaseDrag(e);
    if (!drag) return;

    if (drag.holding) return; // 롱프레스 쓰다듬기 종료 — 팝업 없이 마무리
    if (!drag.moved) { // 탭 — 기존 동작 (깨우기 + 개체 팝업)
      if (drag.ent.state === STATE.NAPPING) _setState(drag.ent, STATE.IDLE);
      HomeModule.openSnailPopup(drag.ent.id);
      return;
    }
    _setState(drag.ent, STATE.IDLE); // IDLE 진입이 clamp + 위치 저장을 처리한다
  }

  /** 브라우저가 제스처를 가져간 경우(스크롤 전환 등) — 탭으로 취급하지 않고 조용히 내려놓는다 */
  function _onPointerCancel(e) {
    const drag = _releaseDrag(e);
    if (drag && drag.moved) _setState(drag.ent, STATE.IDLE);
  }

  function init() {
    window.addEventListener('resize', _onResize);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause();
      else resume();
    });

    // 서식지 터치: 달팽이 근처면 탭=팝업/드래그=옮기기, 빈 곳이면 먹이 드롭
    _habitat().addEventListener('pointerdown', _onPointerDown);
    _habitat().addEventListener('pointermove', _onPointerMove);
    _habitat().addEventListener('pointerup', _onPointerUp);
    _habitat().addEventListener('pointercancel', _onPointerCancel);

    sync();
    restoreDrops(); // 지난 세션에 떨어뜨린 먹이 복원 → 이어 먹기
    _startVisitors();
  }

  return {
    MOTION: MOTION,
    init: init,
    sync: sync,
    pause: pause,
    resume: resume,
    dropFood: dropFood,
    restoreDrops: restoreDrops,
    dropFoodRandom: dropFoodRandom,
    dropFoodNear: dropFoodNear,
    effect: effect,
    setBehaviorRng: setBehaviorRng,
    applyScene: applyScene,
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
