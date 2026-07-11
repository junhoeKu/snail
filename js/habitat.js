/**
 * HabitatModule — 서식지 (달팽이 좌표/이동/먹이 연출)
 * 전역 네임스페이스: HabitatModule
 *
 * 게임 밸런스 수치는 GAME.CONFIG에만 둔다. 여기의 MOTION은 연출/모션 수치 전용이다.
 * localStorage 직접 접근 금지 — 위치 저장도 DB.Snail을 경유한다.
 */
const HabitatModule = (function () {
  'use strict';

  // ── 모션/연출 수치 (2차_MVP_구현계획.md §4.2). QA/튜닝용으로 export ──
  const MOTION = {
    WANDER_SPEED: 18,     // px/s
    SEEK_SPEED: 28,       // px/s
    IDLE_MIN_MS: 2000,
    IDLE_MAX_MS: 5000,
    EAT_DURATION_MS: 1800,
    EAT_DISTANCE: 30,     // px
    ARRIVE_DISTANCE: 2,   // px
    EDGE_PADDING: 8,      // px (스프라이트 절반 크기에 더하는 여백)
    FLIP_RIGHT: -1,       // 🐌 이모지는 왼쪽을 보므로 오른쪽 이동 시 반전
    FLIP_LEFT: 1
  };

  const STATE = {
    IDLE: 'idle',
    WANDERING: 'wandering',
    SEEKING: 'seeking_food',
    EATING: 'eating'
  };

  // 현재 위치(px). 영속 저장은 0~1 비율 좌표로 sn_snail.pos에 한다
  const _pos = { x: 0, y: 0 };

  let _state = STATE.IDLE;
  let _target = null;       // { x, y }
  let _facing = 0;          // MOTION.FLIP_* 값
  let _idleUntil = 0;
  let _rafId = null;
  let _lastTs = null;
  let _running = false;

  // ── 좌표/렌더 ──────────────────────────────────────────

  function _habitat() { return document.getElementById('snail-habitat'); }
  function _entity() { return document.getElementById('snail-entity'); }

  function _bounds() {
    const el = _habitat();
    return { w: el.clientWidth, h: el.clientHeight };
  }

  /** 성장 단계별 스프라이트 크기를 감안한 경계 여백(px) */
  function _edge() {
    const half = (_entity().offsetWidth || 0) / 2;
    return half + MOTION.EDGE_PADDING;
  }

  /** 좌표를 서식지 경계 안으로 보정 */
  function _clampPoint(x, y) {
    const b = _bounds();
    const edge = _edge();
    return {
      x: Math.min(Math.max(x, edge), Math.max(b.w - edge, edge)),
      y: Math.min(Math.max(y, edge), Math.max(b.h - edge, edge))
    };
  }

  function _renderPosition() {
    _entity().style.transform =
      'translate3d(' + _pos.x + 'px, ' + _pos.y + 'px, 0) translate(-50%, -50%)';
  }

  /** DB의 비율 좌표 → 현재 서식지 px 좌표 */
  function _loadPosition() {
    const snail = DB.Snail.get();
    const b = _bounds();
    const rx = snail.pos && typeof snail.pos.rx === 'number' ? snail.pos.rx : 0.5;
    const ry = snail.pos && typeof snail.pos.ry === 'number' ? snail.pos.ry : 0.5;
    const p = _clampPoint(rx * b.w, ry * b.h);
    _pos.x = p.x;
    _pos.y = p.y;
    _renderPosition();
  }

  /** 현재 px 좌표 → 비율 좌표로 저장 */
  function _savePosition() {
    const b = _bounds();
    if (!b.w || !b.h) return;
    const snail = DB.Snail.get();
    snail.pos = {
      rx: Math.round((_pos.x / b.w) * 1000) / 1000,
      ry: Math.round((_pos.y / b.h) * 1000) / 1000
    };
    DB.Snail.save(snail);
  }

  function _onResize() {
    const p = _clampPoint(_pos.x, _pos.y);
    _pos.x = p.x;
    _pos.y = p.y;
    _renderPosition();
  }

  // ── 상태 머신 ──────────────────────────────────────────

  function _setState(next) {
    _state = next;
    _entity().className = 'snail-entity state-' + next;

    if (next === STATE.IDLE) {
      _target = null;
      _idleUntil = performance.now() +
        MOTION.IDLE_MIN_MS + Math.random() * (MOTION.IDLE_MAX_MS - MOTION.IDLE_MIN_MS);
      // 성장으로 스프라이트가 커졌을 수 있으므로 경계 재보정 후 위치 저장
      const p = _clampPoint(_pos.x, _pos.y);
      _pos.x = p.x;
      _pos.y = p.y;
      _renderPosition();
      _savePosition();
    }
  }

  /** 서식지 안 무작위 지점을 목표로 배회 시작 */
  function _startWander() {
    const b = _bounds();
    const edge = _edge();
    _target = _clampPoint(
      edge + Math.random() * Math.max(b.w - edge * 2, 1),
      edge + Math.random() * Math.max(b.h - edge * 2, 1)
    );
    _setState(STATE.WANDERING);
  }

  function _setFacing(dir) {
    if (dir === _facing) return;
    _facing = dir;
    document.getElementById('snail-sprite').style.setProperty('--flip', dir);
  }

  /**
   * 목표 좌표로 등속 이동 (프레임 독립적)
   * @returns {boolean} 도착 여부
   */
  function _moveToward(speed, dt) {
    const dx = _target.x - _pos.x;
    const dy = _target.y - _pos.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= MOTION.ARRIVE_DISTANCE) return true;

    const step = Math.min(speed * dt, distance);
    _pos.x += (dx / distance) * step;
    _pos.y += (dy / distance) * step;
    if (Math.abs(dx) > 1) {
      _setFacing(dx > 0 ? MOTION.FLIP_RIGHT : MOTION.FLIP_LEFT);
    }
    _renderPosition();
    return false;
  }

  function _update(dt, nowTs) {
    switch (_state) {
      case STATE.IDLE:
        if (nowTs >= _idleUntil) _startWander();
        break;
      case STATE.WANDERING:
        if (_moveToward(MOTION.WANDER_SPEED, dt)) _setState(STATE.IDLE);
        break;
    }
  }

  // ── 게임 루프 (rAF + deltaTime) ────────────────────────

  function _loop(ts) {
    if (!_running) return;
    if (_lastTs === null) _lastTs = ts;
    const dt = Math.min((ts - _lastTs) / 1000, 0.1); // 탭 복귀 등 큰 점프 방지
    _lastTs = ts;
    _update(dt, ts);
    _rafId = requestAnimationFrame(_loop);
  }

  function _canRun() {
    return DB.Snail.get().stage !== 'egg' &&
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

  function init() {
    window.addEventListener('resize', _onResize);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause();
      else resume();
    });

    if (DB.Snail.get().stage !== 'egg') {
      _loadPosition();
      _setState(STATE.IDLE);
      resume();
    }
  }

  /** 부화 직후 호출 — 저장된 기본 위치(중앙)에서 시작 */
  function onHatched() {
    _loadPosition();
    _setState(STATE.IDLE);
    resume();
  }

  return {
    MOTION: MOTION,
    init: init,
    onHatched: onHatched,
    pause: pause,
    resume: resume,
    /** QA/디버그용 현재 상태 */
    debugState: function () {
      return { state: _state, x: _pos.x, y: _pos.y, running: _running };
    }
  };
})();
