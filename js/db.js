/**
 * DB — LocalStorage 데이터 계층 (단일 창구)
 * 전역 네임스페이스: DB
 *
 * localStorage 접근은 반드시 이 모듈을 통한다.
 * 파싱 실패/용량 초과 시 기본값으로 대응하고, 사용자 데이터를 임의로 삭제하지 않는다.
 */
const DB = (function () {
  'use strict';

  const SCHEMA_VERSION = 5;

  const KEYS = {
    PLAYER: 'sn_player',
    SNAIL: 'sn_snail',   // ~v4 단일 달팽이 (v5에서 sn_snails로 마이그레이션)
    SNAILS: 'sn_snails',
    JOURNAL: 'sn_journal',
    ALBUM: 'sn_album'
  };

  const JOURNAL_MAX = 100; // 성장 일지 최대 보관 건수

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
      background: 'default',
      streak: { count: 0, last_date: null },
      missions: { date: null, feed: 0, pet: 0, bonus_given: false },
      generation: 1,             // 현재 세대 (여행 보내기마다 +1)
      mission_completions: 0,    // 미션 완주 누적 (장식 해금 조건)
      sound_on: true,
      decorations: { owned: [], slots: [null, null, null] },
      snail_slots: 1,            // 보금자리 수 (최대 3 — 상점에서 확장)
      explore: { date: null, searches: 0 }, // 탐험 스태미나 (하루 리셋)
      unlocked_maps: []
    };
  }

  function _newId() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function _defaultSnail() {
    return {
      schema_version: SCHEMA_VERSION,
      id: _newId(),
      name: '',
      level: 0,
      exp: 0,
      hunger: 0,
      happiness: 100,
      stage: 'egg',
      color: 'brown',        // 껍질 변이 (부화 시 결정)
      personality: null,     // 성격 (부화 시 결정, 구버전 데이터는 부팅 시 소급 부여)
      wild_variant: null,    // 야생 알: 발견한 맵에서 예약된 변이 (부화 시 사용)
      pos: { rx: 0.5, ry: 0.5 }, // 서식지 내 위치 (0~1 비율 좌표)
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
    if (!stored) {
      _write(key, merged);
    } else if (stored.schema_version !== SCHEMA_VERSION) {
      // 구버전 레코드: 기본값 병합으로 누락 필드를 채우고 버전을 올려 저장
      merged.schema_version = SCHEMA_VERSION;
      _write(key, merged);
    }
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

  /** 달팽이 목록 (v5) — 각 레코드는 id를 가진다. 알도 목록의 한 원소 */
  const Snails = {
    get: function () {
      let list = _read(KEYS.SNAILS);
      let dirty = false;

      if (!Array.isArray(list)) {
        // v4 이하 단일 레코드 → 배열 마이그레이션 (무손실)
        const legacy = _read(KEYS.SNAIL);
        list = [legacy || _defaultSnail()];
        localStorage.removeItem(KEYS.SNAIL);
        dirty = true;
      }

      // 필드 치유 (기본값 병합 + id/버전 보장). 치유가 일어나면 영속화해 id를 고정한다
      const healed = list.map(function (record) {
        if (!record.id || record.schema_version !== SCHEMA_VERSION) dirty = true;
        const merged = Object.assign(_defaultSnail(), record);
        merged.schema_version = SCHEMA_VERSION;
        return merged;
      });
      if (dirty) _write(KEYS.SNAILS, healed);
      return healed;
    },
    save: function (list) {
      return _write(KEYS.SNAILS, list);
    },
    getById: function (id) {
      return Snails.get().find(function (s) { return s.id === id; }) || null;
    },
    /** 같은 id 레코드를 교체 저장 */
    saveOne: function (snail) {
      const list = Snails.get().map(function (s) { return s.id === snail.id ? snail : s; });
      return _write(KEYS.SNAILS, list);
    },
    /** 추가 (id 없으면 부여) */
    add: function (snail) {
      if (!snail.id) snail.id = _newId();
      const list = Snails.get();
      list.push(snail);
      return _write(KEYS.SNAILS, list) && snail.id;
    },
    removeById: function (id) {
      const list = Snails.get().filter(function (s) { return s.id !== id; });
      return _write(KEYS.SNAILS, list);
    }
  };

  /**
   * 대표 달팽이 (첫 번째 레코드) — v4 호환 shim.
   * 멀티 전환(6차 2~3단계) 동안만 사용하고 이후 제거한다.
   */
  const Snail = {
    get: function () {
      return Snails.get()[0];
    },
    save: function (snail) {
      return Snails.saveOne(snail);
    }
  };

  /** 앨범 — 여행 보낸 역대 달팽이 기록 (세대순 append) */
  const Album = {
    get: function () {
      const stored = _read(KEYS.ALBUM);
      return Array.isArray(stored) ? stored : [];
    },
    add: function (record) {
      const list = Album.get();
      list.push(record);
      return _write(KEYS.ALBUM, list);
    }
  };

  /** 성장 일지 — 최근 JOURNAL_MAX건 유지 */
  const Journal = {
    get: function () {
      const stored = _read(KEYS.JOURNAL);
      return Array.isArray(stored) ? stored : [];
    },
    add: function (type, text) {
      const list = Journal.get();
      list.push({ ts: now(), type: type, text: text });
      while (list.length > JOURNAL_MAX) list.shift();
      return _write(KEYS.JOURNAL, list);
    }
  };

  /**
   * 전체 초기화 — 설정 화면의 확인 모달 또는 개발/QA 콘솔에서만 호출한다.
   * (사용자 확인 없는 데이터 삭제 금지)
   */
  function reset() {
    localStorage.removeItem(KEYS.PLAYER);
    localStorage.removeItem(KEYS.SNAIL);
    localStorage.removeItem(KEYS.SNAILS);
    localStorage.removeItem(KEYS.JOURNAL);
    localStorage.removeItem(KEYS.ALBUM);
    console.warn('[DB] 초기화 완료. 새로고침하면 온보딩부터 시작합니다.');
  }

  /** 백업/복구 — 전체 데이터 스냅샷 (설정 탭의 백업 기능이 사용) */
  function exportAll() {
    return {
      version: SCHEMA_VERSION,
      player: Player.get(),
      snails: Snails.get(),
      journal: Journal.get(),
      album: Album.get()
    };
  }

  /** @returns {boolean} 유효하면 덮어쓰고 true */
  function importAll(data) {
    if (!data || typeof data !== 'object' || !data.player || !Array.isArray(data.snails)) {
      return false;
    }
    _write(KEYS.PLAYER, data.player);
    _write(KEYS.SNAILS, data.snails);
    _write(KEYS.JOURNAL, Array.isArray(data.journal) ? data.journal : []);
    _write(KEYS.ALBUM, Array.isArray(data.album) ? data.album : []);
    return true;
  }

  return {
    KEYS: KEYS,
    Player: Player,
    Snail: Snail,
    Snails: Snails,
    Journal: Journal,
    Album: Album,
    exportAll: exportAll,
    importAll: importAll,
    reset: reset,
    now: now,
    today: today
  };
})();
