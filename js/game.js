/**
 * GAME — 핵심 도메인 로직 (순수 함수)
 * 전역 네임스페이스: GAME
 *
 * DOM/DB에 접근하지 않는다. 입력을 받아 새 상태와 이벤트 목록만 반환한다.
 * 모든 게임 수치는 CONFIG에 모은다 (1차_MVP_구현계획.md §3).
 */
const GAME = (function () {
  'use strict';

  const CONFIG = {
    // 시간 감쇠: 1시간 경과마다 적용
    DECAY_INTERVAL_MIN: 60,
    DECAY_HUNGER: 5,
    DECAY_HAPPINESS: 5,

    // 먹이 주기
    FEED_HUNGER: 30,
    FEED_EXP: 10,
    FEED_HAPPINESS: 5,
    FEED_COINS: 2,

    // 산책
    WALK_COOLDOWN_HOURS: 4,
    WALK_HAPPINESS: 10,
    WALK_COINS: 10,

    // 접속 보상 / 상점
    DAILY_COINS: 20,
    FOOD_PRICE: 10,

    // 성장
    EXP_PER_LEVEL: 20,

    // 부화 직후 초기 스탯
    HATCH_HUNGER: 40,
    HATCH_HAPPINESS: 80,

    STAT_MIN: 0,
    STAT_MAX: 100
  };

  const STAGES = {
    egg: { id: 'egg', label: '알', emoji: '🥚', minLevel: 0 },
    baby: { id: 'baby', label: '아기', emoji: '🐌', minLevel: 1 },
    junior: { id: 'junior', label: '어린', emoji: '🐌', minLevel: 5 },
    adult: { id: 'adult', label: '성체', emoji: '🐌', minLevel: 10 }
  };

  function _clamp(value) {
    return Math.max(CONFIG.STAT_MIN, Math.min(CONFIG.STAT_MAX, value));
  }

  function _clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /** 레벨 → 성장 단계 (부화 이후) */
  function stageForLevel(level) {
    if (level >= STAGES.adult.minLevel) return 'adult';
    if (level >= STAGES.junior.minLevel) return 'junior';
    return 'baby';
  }

  /** 다음 레벨까지 필요한 경험치 */
  function expToNext(level) {
    return level * CONFIG.EXP_PER_LEVEL;
  }

  /**
   * 경험치 획득 → 레벨업 → 단계 변화까지 처리
   * @returns {{snail: object, events: string[]}}
   */
  function gainExp(snail, amount) {
    const s = _clone(snail);
    const events = [];
    if (s.stage === 'egg') return { snail: s, events: events };

    s.exp += amount;
    while (s.exp >= expToNext(s.level)) {
      s.exp -= expToNext(s.level);
      s.level += 1;
      events.push('levelup');

      const nextStage = stageForLevel(s.level);
      if (nextStage !== s.stage) {
        s.stage = nextStage;
        events.push('stage_up');
      }
    }
    return { snail: s, events: events };
  }

  /**
   * 알 → 아기 부화 (이름 짓기)
   * @returns {{snail: object, events: string[]}}
   */
  function hatch(snail, name) {
    const s = _clone(snail);
    const events = [];

    if (s.stage !== 'egg') {
      events.push('already_hatched');
      return { snail: s, events: events };
    }
    const trimmed = (name || '').trim();
    if (!trimmed) {
      events.push('name_required');
      return { snail: s, events: events };
    }

    s.name = trimmed.slice(0, 12);
    s.stage = 'baby';
    s.level = 1;
    s.exp = 0;
    s.hunger = CONFIG.HATCH_HUNGER;
    s.happiness = CONFIG.HATCH_HAPPINESS;
    events.push('hatched');
    return { snail: s, events: events };
  }

  /**
   * 먹이 주기: 상추 1 소모 → 배고픔 감소 + 경험치/행복/코인 증가
   * @returns {{snail: object, player: object, events: string[]}}
   */
  function feed(snail, player) {
    let s = _clone(snail);
    const p = _clone(player);
    let events = [];

    if (s.stage === 'egg') {
      events.push('not_hatched');
      return { snail: s, player: p, events: events };
    }
    if (p.food < 1) {
      events.push('no_food');
      return { snail: s, player: p, events: events };
    }
    if (s.hunger <= 0) {
      events.push('not_hungry');
      return { snail: s, player: p, events: events };
    }

    p.food -= 1;
    p.coins += CONFIG.FEED_COINS;
    s.hunger = _clamp(s.hunger - CONFIG.FEED_HUNGER);
    s.happiness = _clamp(s.happiness + CONFIG.FEED_HAPPINESS);
    events.push('fed');

    const grown = gainExp(s, CONFIG.FEED_EXP);
    s = grown.snail;
    events = events.concat(grown.events);

    return { snail: s, player: p, events: events };
  }

  /**
   * 산책: 쿨다운(4시간) 검사 후 행복/코인 증가
   * @returns {{snail: object, player: object, events: string[]}}
   */
  function walk(snail, player, nowISO) {
    const s = _clone(snail);
    const p = _clone(player);
    const events = [];

    if (s.stage === 'egg') {
      events.push('not_hatched');
      return { snail: s, player: p, events: events };
    }

    const cooldownMs = CONFIG.WALK_COOLDOWN_HOURS * 60 * 60 * 1000;
    if (p.last_walk && new Date(nowISO) - new Date(p.last_walk) < cooldownMs) {
      events.push('walk_cooldown');
      return { snail: s, player: p, events: events };
    }

    s.happiness = _clamp(s.happiness + CONFIG.WALK_HAPPINESS);
    p.coins += CONFIG.WALK_COINS;
    p.last_walk = nowISO;
    events.push('walked');
    return { snail: s, player: p, events: events };
  }

  /**
   * 일일 접속 보상 (하루 1회, 날짜 키 YYYY-MM-DD 기준)
   * @returns {{player: object, events: string[]}}
   */
  function claimDaily(player, todayKey) {
    const p = _clone(player);
    const events = [];

    if (p.last_daily_reward === todayKey) {
      events.push('already_claimed');
      return { player: p, events: events };
    }

    p.coins += CONFIG.DAILY_COINS;
    p.last_daily_reward = todayKey;
    events.push('daily_claimed');
    return { player: p, events: events };
  }

  /**
   * 경과 시간 정산: 1시간 단위로만 적용하고, 적용한 구간 수를 intervals로 반환한다.
   * 호출부는 intervals만큼만 last_seen을 전진시켜 잔여 시간을 잃지 않게 한다.
   * @returns {{snail: object, events: string[], intervals: number}}
   */
  function applyTimeDecay(snail, lastSeenISO, nowISO) {
    const s = _clone(snail);
    const events = [];

    if (s.stage === 'egg' || !lastSeenISO) {
      return { snail: s, events: events, intervals: 0 };
    }

    const elapsedMin = (new Date(nowISO) - new Date(lastSeenISO)) / 60000;
    const intervals = Math.floor(elapsedMin / CONFIG.DECAY_INTERVAL_MIN);
    if (intervals <= 0) {
      return { snail: s, events: events, intervals: 0 };
    }

    s.hunger = _clamp(s.hunger + intervals * CONFIG.DECAY_HUNGER);
    s.happiness = _clamp(s.happiness - intervals * CONFIG.DECAY_HAPPINESS);
    events.push('decayed');
    return { snail: s, events: events, intervals: intervals };
  }

  /**
   * 상추 구매
   * @returns {{player: object, events: string[]}}
   */
  function buyFood(player) {
    const p = _clone(player);
    const events = [];

    if (p.coins < CONFIG.FOOD_PRICE) {
      events.push('not_enough_coins');
      return { player: p, events: events };
    }

    p.coins -= CONFIG.FOOD_PRICE;
    p.food += 1;
    events.push('food_bought');
    return { player: p, events: events };
  }

  return {
    CONFIG: CONFIG,
    STAGES: STAGES,
    stageForLevel: stageForLevel,
    expToNext: expToNext,
    gainExp: gainExp,
    hatch: hatch,
    feed: feed,
    walk: walk,
    claimDaily: claimDaily,
    applyTimeDecay: applyTimeDecay,
    buyFood: buyFood
  };
})();
