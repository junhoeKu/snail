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

    // 출석 스트릭
    STREAK_BONUS_PER_DAY: 2,   // 연속 1일당 추가 코인
    STREAK_BONUS_CAP: 20,      // 스트릭 보너스 상한
    STREAK_WEEKLY_FOOD: 3,     // 7일 연속마다 상추 지급

    // 데일리 미션
    MISSION_REWARD_COINS: 10,  // 미션 1개 달성 보상
    MISSION_BONUS_COINS: 20,   // 3개 완주 보너스 코인
    MISSION_BONUS_FOOD: 1,     // 3개 완주 보너스 상추

    // 쓰다듬기
    PET_HAPPINESS: 5,
    PET_COOLDOWN_MIN: 30,

    // 성장
    EXP_PER_LEVEL: 20,

    // 부화 직후 초기 스탯
    HATCH_HUNGER: 40,
    HATCH_HAPPINESS: 80,

    // 복귀 리포트 / 부재 중 발견
    AWAY_REPORT_MIN: 30,     // 부재 N분 이상이면 복귀 리포트 표시
    FIND_INTERVAL_HOURS: 4,  // 부재 N시간마다 발견 판정 1회
    FIND_CHANCE: 0.35,
    FIND_MAX: 2,             // 누적 최대 발견 건수
    FIND_COIN_MIN: 5,
    FIND_COIN_MAX: 15,
    FIND_FOOD_CHANCE: 0.3,   // 발견물이 상추일 확률 (나머지는 코인)

    STAT_MIN: 0,
    STAT_MAX: 100
  };

  /** 데일리 미션 정의 (UI 라벨/목표 공용) */
  const MISSION_DEFS = {
    feed: { id: 'feed', label: '밥 챙겨주기', goal: 2 },
    walk: { id: 'walk', label: '산책 다녀오기', goal: 1 },
    pet: { id: 'pet', label: '쓰다듬어주기', goal: 1 }
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

  /** YYYY-MM-DD의 하루 전 날짜 키 (정오 기준 계산으로 DST 이슈 회피) */
  function _prevDayKey(dateKey) {
    const d = new Date(dateKey + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + month + '-' + day;
  }

  /**
   * 출석 스트릭 갱신 + 접속 보상 (하루 1회).
   * 어제 접속했으면 스트릭 +1, 끊겼으면 조용히 1일차부터 (페널티 없음).
   * @returns {{player: object, events: string[], coins: number, food: number, streak: number}}
   */
  function applyStreak(player, todayKey) {
    const p = _clone(player);
    const events = [];

    if (p.last_daily_reward === todayKey) {
      events.push('already_claimed');
      return { player: p, events: events, coins: 0, food: 0, streak: p.streak ? p.streak.count : 0 };
    }

    const prev = p.streak && p.streak.last_date;
    const count = (prev === _prevDayKey(todayKey)) ? p.streak.count + 1 : 1;
    p.streak = { count: count, last_date: todayKey };

    const bonus = Math.min((count - 1) * CONFIG.STREAK_BONUS_PER_DAY, CONFIG.STREAK_BONUS_CAP);
    const coins = CONFIG.DAILY_COINS + bonus;
    const food = (count % 7 === 0) ? CONFIG.STREAK_WEEKLY_FOOD : 0;

    p.coins += coins;
    p.food += food;
    p.last_daily_reward = todayKey;
    events.push('daily_claimed');
    if (food > 0) events.push('streak_weekly');
    return { player: p, events: events, coins: coins, food: food, streak: count };
  }

  /** 오늘 날짜 기준 미션 상태 (지난 날짜면 초기 상태 반환) */
  function _missionsFor(player, todayKey) {
    const m = player.missions;
    if (m && m.date === todayKey) return _clone(m);
    return { date: todayKey, feed: 0, walk: 0, pet: 0, bonus_given: false };
  }

  /**
   * 미션 진행 기록 + 달성/완주 보상 자동 지급
   * @param {string} kind 'feed' | 'walk' | 'pet'
   * @returns {{player: object, events: string[], coins: number, food: number}}
   */
  function recordMission(player, kind, todayKey) {
    const p = _clone(player);
    const events = [];
    let coins = 0;
    let food = 0;

    const def = MISSION_DEFS[kind];
    if (!def) return { player: p, events: events, coins: 0, food: 0 };

    const m = _missionsFor(p, todayKey);
    const doneBefore = m[kind] >= def.goal;
    m[kind] += 1;

    if (!doneBefore && m[kind] >= def.goal) {
      coins += CONFIG.MISSION_REWARD_COINS;
      events.push('mission_done');
    }

    const allDone = Object.keys(MISSION_DEFS).every(function (k) {
      return m[k] >= MISSION_DEFS[k].goal;
    });
    if (allDone && !m.bonus_given) {
      m.bonus_given = true;
      coins += CONFIG.MISSION_BONUS_COINS;
      food += CONFIG.MISSION_BONUS_FOOD;
      events.push('mission_all_done');
    }

    p.coins += coins;
    p.food += food;
    p.missions = m;
    return { player: p, events: events, coins: coins, food: food };
  }

  /**
   * 미션 진행 요약 (UI용)
   * @returns {{done: number, total: number, allDone: boolean, items: object[]}}
   */
  function missionProgress(player, todayKey) {
    const m = _missionsFor(player, todayKey);
    const items = Object.keys(MISSION_DEFS).map(function (k) {
      const def = MISSION_DEFS[k];
      return {
        id: k,
        label: def.label,
        count: Math.min(m[k], def.goal),
        goal: def.goal,
        done: m[k] >= def.goal
      };
    });
    const done = items.filter(function (it) { return it.done; }).length;
    return { done: done, total: items.length, allDone: done === items.length, items: items };
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
   * 쓰다듬기: 행복 상승 (쿨다운 30분)
   * @returns {{snail: object, player: object, events: string[]}}
   */
  function pet(snail, player, nowISO) {
    const s = _clone(snail);
    const p = _clone(player);
    const events = [];

    if (s.stage === 'egg') {
      events.push('not_hatched');
      return { snail: s, player: p, events: events };
    }

    const cooldownMs = CONFIG.PET_COOLDOWN_MIN * 60 * 1000;
    if (p.last_pet && new Date(nowISO) - new Date(p.last_pet) < cooldownMs) {
      events.push('pet_cooldown');
      return { snail: s, player: p, events: events };
    }

    s.happiness = _clamp(s.happiness + CONFIG.PET_HAPPINESS);
    p.last_pet = nowISO;
    events.push('petted');
    return { snail: s, player: p, events: events };
  }

  /**
   * 부재 정산 통합: 시간 감쇠 + 부재 중 발견(긍정적 오프라인 진행).
   * 복귀 리포트에 쓸 요약(report)을 함께 반환한다.
   * @param {Function} [rng] 난수 함수 주입 (기본 Math.random — 테스트에서 시드 고정용)
   * @returns {{snail: object, player: object, report: object, events: string[]}}
   */
  function summarizeAway(snail, player, nowISO, rng) {
    const random = rng || Math.random;
    let s = _clone(snail);
    const p = _clone(player);
    const events = [];
    const report = { away_minutes: 0, hunger_delta: 0, happiness_delta: 0, finds: [] };

    if (s.stage === 'egg' || !p.last_seen) {
      return { snail: s, player: p, report: report, events: events };
    }

    report.away_minutes = Math.max(0, Math.floor((new Date(nowISO) - new Date(p.last_seen)) / 60000));

    // 1) 시간 감쇠 (기존 로직 재사용, last_seen은 적용 구간만큼만 전진)
    const decay = applyTimeDecay(s, p.last_seen, nowISO);
    report.hunger_delta = decay.snail.hunger - s.hunger;
    report.happiness_delta = decay.snail.happiness - s.happiness;
    s = decay.snail;
    if (decay.intervals > 0) {
      p.last_seen = new Date(
        new Date(p.last_seen).getTime() + decay.intervals * CONFIG.DECAY_INTERVAL_MIN * 60 * 1000
      ).toISOString();
      events.push('decayed');
    }

    // 2) 부재 중 발견 — FIND_INTERVAL_HOURS마다 1회 판정, 최대 FIND_MAX건
    const chances = Math.floor(report.away_minutes / (CONFIG.FIND_INTERVAL_HOURS * 60));
    for (let i = 0; i < chances && report.finds.length < CONFIG.FIND_MAX; i++) {
      if (random() >= CONFIG.FIND_CHANCE) continue;
      if (random() < CONFIG.FIND_FOOD_CHANCE) {
        p.food += 1;
        report.finds.push({ type: 'food', amount: 1 });
      } else {
        const amount = CONFIG.FIND_COIN_MIN +
          Math.floor(random() * (CONFIG.FIND_COIN_MAX - CONFIG.FIND_COIN_MIN + 1));
        p.coins += amount;
        report.finds.push({ type: 'coins', amount: amount });
      }
      events.push('found_item');
    }

    return { snail: s, player: p, report: report, events: events };
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
    MISSION_DEFS: MISSION_DEFS,
    applyStreak: applyStreak,
    recordMission: recordMission,
    missionProgress: missionProgress,
    stageForLevel: stageForLevel,
    expToNext: expToNext,
    gainExp: gainExp,
    hatch: hatch,
    feed: feed,
    walk: walk,
    pet: pet,
    applyTimeDecay: applyTimeDecay,
    summarizeAway: summarizeAway,
    buyFood: buyFood
  };
})();
