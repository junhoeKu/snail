/**
 * DB — LocalStorage 데이터 계층 (단일 창구)
 * 전역 네임스페이스: DB
 *
 * localStorage 접근은 반드시 이 모듈을 통한다.
 * 파싱 실패/용량 초과 시 기본값으로 대응하고, 사용자 데이터를 임의로 삭제하지 않는다.
 */
const DB = (function () {
  'use strict';

  const SCHEMA_VERSION = 1;

  const KEYS = {
    PLAYER: 'sn_player',
    SNAIL: 'sn_snail'
  };

  /** 현재 타임스탬프 (ISO 문자열, 로컬 기준) */
  function now() {
    return new Date().toISOString();
  }

  /** 오늘 날짜 키 (YYYY-MM-DD, 로컬 시간 기준) */
  function today() {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + month + '-' + day;
  }

  function _read(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') {
        console.warn('[DB] 잘못된 형식, 기본값 사용:', key);
        return null;
      }
      return data;
    } catch (e) {
      console.warn('[DB] 파싱 실패, 기본값 사용:', key, e);
      return null;
    }
  }

  function _write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[DB] 저장 실패 (용량 초과 가능):', key, e);
      return false;
    }
  }

  function _defaultPlayer() {
    return {
      schema_version: SCHEMA_VERSION,
      coins: 30,
      food: 3,
      last_seen: now(),
      last_daily_reward: null,
      last_walk: null,
      background: 'default'
    };
  }

  function _defaultSnail() {
    return {
      schema_version: SCHEMA_VERSION,
      name: '',
      level: 0,
      exp: 0,
      hunger: 0,
      happiness: 100,
      stage: 'egg',
      color: 'default',
      created_at: now()
    };
  }

  /**
   * 저장된 레코드를 기본값 위에 병합해 반환한다.
   * 필드 누락(구버전 스키마)을 스스로 치유하고, 첫 실행이면 기본값을 저장한다.
   */
  function _getOrInit(key, defaultFactory) {
    const stored = _read(key);
    const merged = Object.assign(defaultFactory(), stored || {});
    if (!stored) _write(key, merged);
    return merged;
  }

  const Player = {
    get: function () {
      return _getOrInit(KEYS.PLAYER, _defaultPlayer);
    },
    save: function (player) {
      return _write(KEYS.PLAYER, player);
    }
  };

  const Snail = {
    get: function () {
      return _getOrInit(KEYS.SNAIL, _defaultSnail);
    },
    save: function (snail) {
      return _write(KEYS.SNAIL, snail);
    }
  };

  /**
   * 전체 초기화 — 개발/QA 콘솔 전용.
   * 앱 코드에서 호출하지 않는다 (사용자 확인 없는 데이터 삭제 금지).
   */
  function reset() {
    localStorage.removeItem(KEYS.PLAYER);
    localStorage.removeItem(KEYS.SNAIL);
    console.warn('[DB] 초기화 완료. 새로고침하면 온보딩부터 시작합니다.');
  }

  return {
    KEYS: KEYS,
    Player: Player,
    Snail: Snail,
    reset: reset,
    now: now,
    today: today
  };
})();
