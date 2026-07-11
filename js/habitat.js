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
    EDGE_PADDING: 8       // px (스프라이트 절반 크기에 더하는 여백)
  };

  // 현재 위치(px). 영속 저장은 0~1 비율 좌표로 sn_snail.pos에 한다
  const _pos = { x: 0, y: 0 };

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

  // ── 라이프사이클 ──────────────────────────────────────

  function init() {
    window.addEventListener('resize', _onResize);
    if (DB.Snail.get().stage !== 'egg') {
      _loadPosition();
    }
  }

  /** 부화 직후 호출 — 저장된 기본 위치(중앙)에서 시작 */
  function onHatched() {
    _loadPosition();
  }

  return {
    MOTION: MOTION,
    init: init,
    onHatched: onHatched
  };
})();
