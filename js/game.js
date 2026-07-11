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

    // 여행 보내기 (세대 교체)
    GRADUATE_MIN_LEVEL: 12,
    GRADUATE_COINS: 100,
    GENERATION_BOOST_CAP: 5, // 변이 확률 보정이 커지는 최대 세대 수 (6세대+에서 고정)

    // 성장
    EXP_PER_LEVEL: 20,

    // 부화 직후 초기 스탯
    HATCH_HUNGER: 40,
    HATCH_HAPPINESS: 80,

    // 컨디션 (스탯 파생 — 속도/표정)
    HUNGRY_THRESHOLD: 70,
    HUNGRY_SPEED: 0.7,
    HAPPY_THRESHOLD: 80,
    HAPPY_SPEED: 1.15,

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

  /** 날씨 (날짜 해시로 결정적 — 저장 불필요) */
  const WEATHER = {
    sunny: { id: 'sunny', label: '맑음', idleFactor: 1, speedFactor: 1 },
    rain: { id: 'rain', label: '비', idleFactor: 0.6, speedFactor: 1.2 }, // 달팽이는 비를 좋아한다
    fog: { id: 'fog', label: '안개', idleFactor: 1, speedFactor: 1 }
  };

  /** 성격 (부화 시 랜덤 1개 — 행동 가중치) */
  const PERSONALITIES = {
    foodie: { id: 'foodie', label: '먹보', chance: 0.40, seekFactor: 1.3, idleFactor: 1, napFactor: 1 },
    explorer: { id: 'explorer', label: '모험가', chance: 0.35, seekFactor: 1, idleFactor: 0.7, napFactor: 1 },
    sleepy: { id: 'sleepy', label: '잠꾸러기', chance: 0.25, seekFactor: 1, idleFactor: 1, napFactor: 2 }
  };

  /** 껍질 변이 (부화 시 랜덤) — chance는 1세대 기준, 세대 보정은 variantTableFor */
  const VARIANTS = {
    brown: { id: 'brown', label: '갈색', chance: 0.55 },
    gray: { id: 'gray', label: '회갈색', chance: 0.18 },
    russet: { id: 'russet', label: '적갈색', chance: 0.15 },
    olive: { id: 'olive', label: '올리브', chance: 0.10 },
    golden: { id: 'golden', label: '황금', chance: 0.02 }
  };

  /** 세대당 변이 확률 변화 (%p) — 합계 0이라 항상 총합 100% 유지 */
  const VARIANT_GEN_DELTA = { brown: -6, gray: 1, russet: 1.5, olive: 2, golden: 1.5 };

  /** 세대 보정된 변이 확률 테이블 (5차_MVP_구현계획.md §3.2) */
  function variantTableFor(generation) {
    const boost = Math.min(Math.max((generation || 1) - 1, 0), CONFIG.GENERATION_BOOST_CAP);
    const table = {};
    Object.keys(VARIANTS).forEach(function (key) {
      const base = VARIANTS[key];
      table[key] = {
        id: base.id,
        label: base.label,
        chance: (base.chance * 100 + VARIANT_GEN_DELTA[key] * boost) / 100
      };
    });
    return table;
  }

  /** 가중치 테이블에서 하나 추첨 */
  function _pickWeighted(table, roll) {
    const keys = Object.keys(table);
    let acc = 0;
    for (let i = 0; i < keys.length; i++) {
      acc += table[keys[i]].chance;
      if (roll < acc) return keys[i];
    }
    return keys[keys.length - 1];
  }

  function rollPersonality(rng) {
    return _pickWeighted(PERSONALITIES, (rng || Math.random)());
  }

  /** @param {number} [generation] 세대 보정 (생략 시 1세대 확률) */
  function rollVariant(rng, generation) {
    return _pickWeighted(variantTableFor(generation), (rng || Math.random)());
  }

  /** 날짜 키 → 날씨 id (결정적 해시: 맑음 60% / 비 25% / 안개 15%) */
  function weatherFor(dateKey) {
    let hash = 0;
    for (let i = 0; i < dateKey.length; i++) {
      hash = ((hash << 5) - hash + dateKey.charCodeAt(i)) | 0;
    }
    const roll = Math.abs(hash) % 100;
    if (roll < 60) return 'sunny';
    if (roll < 85) return 'rain';
    return 'fog';
  }

  /** 스탯 → 컨디션 (표정/속도 배수. 저장하지 않고 파생) */
  function conditionOf(snail) {
    if (snail.stage === 'egg') return { id: 'normal', speedFactor: 1 };
    if (snail.hunger >= CONFIG.HUNGRY_THRESHOLD) return { id: 'hungry', speedFactor: CONFIG.HUNGRY_SPEED };
    if (snail.happiness >= CONFIG.HAPPY_THRESHOLD) return { id: 'happy', speedFactor: CONFIG.HAPPY_SPEED };
    return { id: 'normal', speedFactor: 1 };
  }

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
   * 알 → 아기 부화 (이름 짓기 + 성격/변이 결정)
   * @param {Function} [rng] 난수 함수 주입 (테스트용)
   * @param {number} [generation] 세대 (변이 확률 보정)
   * @returns {{snail: object, events: string[]}}
   */
  function hatch(snail, name, rng, generation) {
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
    s.personality = rollPersonality(rng);
    s.color = rollVariant(rng, generation);
    events.push('hatched');
    return { snail: s, events: events };
  }

  /**
   * 도감 발견 목록 — 별도 저장 없이 앨범 + 현재 달팽이에서 파생한다
   * @returns {string[]} 발견한 변이 id 목록
   */
  function discoveredVariants(album, snail) {
    const found = {};
    (album || []).forEach(function (record) {
      if (record.color) found[record.color] = true;
    });
    if (snail && snail.stage !== 'egg' && snail.color) found[snail.color] = true;
    return Object.keys(VARIANTS).filter(function (key) { return found[key]; });
  }

  /** 여행 보내기 가능 여부 (성체 && Lv12+) */
  function canGraduate(snail) {
    return snail.stage === 'adult' && snail.level >= CONFIG.GRADUATE_MIN_LEVEL;
  }

  /**
   * 여행 보내기 (세대 교체): 앨범 레코드 생성 + 기념 코인 + 새 알 + 세대 +1.
   * 스탯/코인/상추/스트릭/미션은 유지되고 달팽이만 앨범으로 이동한다.
   * @returns {{snail: object(새 알), player: object, record: object|null, events: string[]}}
   */
  function graduate(snail, player, nowISO) {
    const p = _clone(player);
    const events = [];

    if (!canGraduate(snail)) {
      events.push('cannot_graduate');
      return { snail: _clone(snail), player: p, record: null, events: events };
    }

    const record = {
      name: snail.name,
      color: snail.color || 'brown',
      personality: snail.personality,
      level: snail.level,
      generation: p.generation || 1,
      hatched_at: snail.created_at,
      graduated_at: nowISO
    };

    p.coins += CONFIG.GRADUATE_COINS;
    p.generation = (p.generation || 1) + 1;

    const egg = {
      schema_version: snail.schema_version,
      name: '',
      level: 0,
      exp: 0,
      hunger: 0,
      happiness: 100,
      stage: 'egg',
      color: 'brown',
      personality: null,
      pos: { rx: 0.5, ry: 0.5 },
      created_at: nowISO
    };

    events.push('graduated');
    return { snail: egg, player: p, record: record, events: events };
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
    WEATHER: WEATHER,
    PERSONALITIES: PERSONALITIES,
    VARIANTS: VARIANTS,
    MISSION_DEFS: MISSION_DEFS,
    weatherFor: weatherFor,
    conditionOf: conditionOf,
    rollPersonality: rollPersonality,
    rollVariant: rollVariant,
    variantTableFor: variantTableFor,
    discoveredVariants: discoveredVariants,
    canGraduate: canGraduate,
    graduate: graduate,
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
