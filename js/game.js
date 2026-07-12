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
    DECAY_HUNGER: 7,
    DECAY_HAPPINESS: 5,

    // 먹이 주기 (종류별 효과는 FOOD_DEFS)
    FEED_COINS: 2,
    FOOD_BUNDLE_DISCOUNT: 0.9, // ×10 묶음 10% 할인

    // 양육자 레벨
    KEEPER_XP: {
      feed: 2,
      explore: 1,
      daily: 5,
      mission: 5,
      mission_all: 10,
      hatch: 15,
      graduate: 30,
      dex_new: 25
    },
    KEEPER_LEVEL_COIN_MULT: 30, // 레벨업 보상 = 30 × 새 레벨
    KEEPER_STAMINA_LEVELS: [5, 8], // 해당 레벨마다 탐험 스태미나 +2

    // 접속 보상 / 상점
    DAILY_COINS: 20,
    FOOD_BUNDLE_COUNT: 10,
    MAX_SNAILS: 3,
    EGG_SLOT_PRICES: [0, 500, 1500], // [현재 슬롯 수] → 다음 보금자리 가격

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

    // 여행 보내기 (세대 교체)
    GRADUATE_MIN_LEVEL: 20,
    GRADUATE_COINS: 100,
    GENERATION_BOOST_CAP: 5, // 변이 확률 보정이 커지는 최대 세대 수 (6세대+에서 고정)

    // 장식 해금 조건
    DECO_MISSIONS_REQUIRED: 7, // 들꽃: 미션 완주 누적
    DECO_GENERATION_REQUIRED: 2, // 이끼 바위: 세대

    // 탐험 채집
    EXPLORE_SEARCHES_PER_DAY: 10, // 하루 뒤지기 횟수 (맵 공용)
    EXPLORE_COIN_MIN: 3,
    EXPLORE_COIN_MAX: 12,
    EXPLORE_MAP_PRICE: 1000,      // 이슬 연못 코인 해금가
    WILD_EGG_FALLBACK_COINS: 30,  // 보금자리 가득 시 야생 알 → 코인 전환

    // 관리자 모드 (?admin=1 — 졸업 등 실험용)
    ADMIN_COINS: 999999,
    ADMIN_FOOD: 999,
    ADMIN_EXP_MULT: 10, // 먹이 경험치 배수 (빠른 레벨업 실험)

    // 성장
    EXP_PER_LEVEL: 5,

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

  /** 먹이 4종 — 양육자 레벨로 해금 (7차_MVP_구현계획.md §6) */
  const FOOD_DEFS = {
    lettuce: { id: 'lettuce', label: '상추', emoji: '🥬', price: 10, hunger: 30, exp: 22, happiness: 5, unlockLevel: 1 },
    carrot: { id: 'carrot', label: '당근', emoji: '🥕', price: 18, hunger: 45, exp: 28, happiness: 5, unlockLevel: 2 },
    apple: { id: 'apple', label: '사과', emoji: '🍎', price: 30, hunger: 35, exp: 32, happiness: 12, unlockLevel: 4 },
    salad: { id: 'salad', label: '특제 샐러드', emoji: '🥗', price: 60, hunger: 100, exp: 52, happiness: 15, unlockLevel: 6 }
  };

  // ── 양육자 레벨 ────────────────────────────────────────

  function keeperLevel(player) {
    return (player.keeper && player.keeper.level) || 1;
  }

  /** 다음 레벨까지 필요한 양육자 XP */
  function keeperXpToNext(level) {
    return 50 + (level - 1) * 25;
  }

  /**
   * 양육자 XP 획득 (+레벨업 시 코인 보상)
   * @param {string} action KEEPER_XP 테이블의 키
   * @returns {{player: object, events: string[], coins: number, level: number}}
   */
  function gainKeeperXp(player, action) {
    const p = _clone(player);
    const events = [];
    if (!p.keeper) p.keeper = { level: 1, xp: 0 };

    const amount = CONFIG.KEEPER_XP[action] || 0;
    let coins = 0;
    if (amount > 0) {
      p.keeper.xp += amount;
      while (p.keeper.xp >= keeperXpToNext(p.keeper.level)) {
        p.keeper.xp -= keeperXpToNext(p.keeper.level);
        p.keeper.level += 1;
        coins += CONFIG.KEEPER_LEVEL_COIN_MULT * p.keeper.level;
        events.push('keeper_levelup');
      }
      p.coins += coins;
    }
    return { player: p, events: events, coins: coins, level: p.keeper.level };
  }

  /** 먹이 해금 여부 (관리자는 전부 해금) */
  function foodUnlocked(player, foodId) {
    const def = FOOD_DEFS[foodId];
    if (!def) return false;
    return player.admin === true || keeperLevel(player) >= def.unlockLevel;
  }

  /** 데일리 미션 정의 (UI 라벨/목표 공용) */
  const MISSION_DEFS = {
    feed: { id: 'feed', label: '밥 챙겨주기', goal: 2 },
    pet: { id: 'pet', label: '쓰다듬어주기', goal: 1 },
    explore: { id: 'explore', label: '탐험 다녀오기', goal: 1 }
  };

  /** 탐험 맵 — 맵마다 특산 변이가 다르다 (수집 전략) */
  const EXPLORE_MAPS = {
    moss: { id: 'moss', label: '이끼 숲', emoji: '🌿', variantBoost: 'olive', locked: false },
    field: { id: 'field', label: '햇살 들판', emoji: '🌤️', variantBoost: 'russet', locked: false },
    pond: { id: 'pond', label: '이슬 연못', emoji: '💧', variantBoost: 'gray', goldenMult: 2, locked: true }
  };

  const STAGES = {
    egg: { id: 'egg', label: '알', emoji: '🥚', minLevel: 0 },
    baby: { id: 'baby', label: '아기', emoji: '🐌', minLevel: 1 },
    junior: { id: 'junior', label: '어린', emoji: '🐌', minLevel: 10 },
    adult: { id: 'adult', label: '성체', emoji: '🐌', minLevel: 20 }
  };

  /** 날씨 (날짜 해시로 결정적 — 저장 불필요) */
  const WEATHER = {
    sunny: { id: 'sunny', label: '맑음', idleFactor: 1, speedFactor: 1 },
    rain: { id: 'rain', label: '비', idleFactor: 0.6, speedFactor: 1.2 }, // 달팽이는 비를 좋아한다
    fog: { id: 'fog', label: '안개', idleFactor: 1, speedFactor: 1 }
  };

  /**
   * 성격 (부화 시 랜덤 1개) — 행동 연출 전용, 게임 수치에는 무영향.
   * 배수는 HabitatModule의 모션 계산에서만 쓰인다.
   */
  const PERSONALITIES = {
    foodie: {
      id: 'foodie', label: '먹보', chance: 0.40, desc: '먹이를 보면 눈빛이 변해요',
      seekFactor: 1.4, speedFactor: 1, idleFactor: 1, napFactor: 1, napLenFactor: 1, eatFactor: 0.7
    },
    explorer: {
      id: 'explorer', label: '개구쟁이', chance: 0.35, desc: '잠시도 가만히 있지 못해요',
      seekFactor: 1, speedFactor: 1.25, idleFactor: 0.5, napFactor: 1, napLenFactor: 1, eatFactor: 1
    },
    sleepy: {
      id: 'sleepy', label: '잠꾸러기', chance: 0.25, desc: '어디서든 스르르 잠들어요',
      seekFactor: 1, speedFactor: 0.85, idleFactor: 1, napFactor: 3, napLenFactor: 1.5, eatFactor: 1
    }
  };

  /**
   * 껍질 변이 (부화 시 랜덤) — chance는 1세대 기준, 세대 보정은 variantTableFor.
   * 등급: 갈색/적갈색/회갈색 = 기본, 올리브 = 레어, 황금 = 에픽
   */
  const RARITIES = {
    common: { id: 'common', label: '기본' },
    rare: { id: 'rare', label: '레어' },
    epic: { id: 'epic', label: '에픽' }
  };

  const VARIANTS = {
    brown: { id: 'brown', label: '갈색', chance: 0.55, rarity: 'common' },
    gray: { id: 'gray', label: '회갈색', chance: 0.18, rarity: 'common' },
    russet: { id: 'russet', label: '적갈색', chance: 0.15, rarity: 'common' },
    olive: { id: 'olive', label: '올리브', chance: 0.10, rarity: 'rare' },
    golden: { id: 'golden', label: '황금', chance: 0.02, rarity: 'epic' }
  };

  /**
   * 스프라이트 경로 단일 생성 지점 — 무효 변이/단계는 brown/baby로 폴백해 404를 원천 차단한다.
   * 화면 모듈은 경로를 직접 문자열로 조립하지 말고 반드시 이 함수를 쓴다.
   */
  function spritePath(color, stage) {
    const safeColor = VARIANTS[color] ? color : 'brown';
    const safeStage = (STAGES[stage] && stage !== 'egg') ? stage : 'baby';
    return 'assets/characters/snail_' + safeColor + '_' + safeStage + '.png';
  }

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

  /** 장식 — 배치(슬롯)된 것만 패시브 효과 발동 (7차_MVP_구현계획.md §5) */
  const DECORATIONS = {
    pebble: { id: 'pebble', label: '조약돌', type: 'buy', price: 50, fxDesc: '행복 감소 15% 완화' },
    mushroom: { id: 'mushroom', label: '버섯', type: 'buy', price: 80, fxDesc: '먹이 배고픔 회복 +10%' },
    wildflower: { id: 'wildflower', label: '들꽃', type: 'unlock', unlockDesc: '미션 완주 누적 7회', fxDesc: '쓰다듬기 행복 +3' },
    mossrock: { id: 'mossrock', label: '이끼 바위', type: 'unlock', unlockDesc: '2세대 도달', fxDesc: '배고픔 증가 10% 완화' }
  };

  /** 배치된 장식의 패시브 수정치 집계 */
  function decorationEffects(player) {
    const slots = (player && player.decorations && player.decorations.slots) || [];
    return {
      happinessDecayMult: slots.indexOf('pebble') !== -1 ? 0.85 : 1,
      feedHungerMult: slots.indexOf('mushroom') !== -1 ? 1.1 : 1,
      petHappinessBonus: slots.indexOf('wildflower') !== -1 ? 3 : 0,
      hungerDecayMult: slots.indexOf('mossrock') !== -1 ? 0.9 : 1
    };
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

  /** 보상/발견 지급용 상추 (기본 먹이) */
  function _grantLettuce(player, amount) {
    if (!player.foods) player.foods = { lettuce: 0 };
    player.foods.lettuce = (player.foods.lettuce || 0) + amount;
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
    // 야생 알은 발견한 맵에서 예약된 변이를 사용한다
    s.color = s.wild_variant || rollVariant(rng, generation);
    s.wild_variant = null;
    events.push('hatched');
    return { snail: s, events: events };
  }

  function _ensureDecorations(player) {
    if (!player.decorations) player.decorations = { owned: [], slots: [null, null, null] };
  }

  /** 해금형 장식의 조건 충족 여부 */
  function decorationUnlockMet(id, player) {
    if (id === 'wildflower') return (player.mission_completions || 0) >= CONFIG.DECO_MISSIONS_REQUIRED;
    if (id === 'mossrock') return (player.generation || 1) >= CONFIG.DECO_GENERATION_REQUIRED;
    return false;
  }

  /**
   * 구매형 장식 구매
   * @returns {{player: object, events: string[]}}
   */
  function buyDecoration(player, id) {
    const p = _clone(player);
    const events = [];
    const def = DECORATIONS[id];
    _ensureDecorations(p);

    if (!def || def.type !== 'buy') {
      events.push('invalid');
      return { player: p, events: events };
    }
    if (p.decorations.owned.indexOf(id) !== -1) {
      events.push('already_owned');
      return { player: p, events: events };
    }
    if (p.coins < def.price) {
      events.push('not_enough_coins');
      return { player: p, events: events };
    }

    p.coins -= def.price;
    p.decorations.owned.push(id);
    events.push('deco_bought');
    return { player: p, events: events };
  }

  /**
   * 해금형 장식 자동 지급 (조건 충족분을 owned에 추가)
   * @returns {{player: object, unlocked: string[]}}
   */
  function claimDecorationUnlocks(player) {
    const p = _clone(player);
    const unlocked = [];
    _ensureDecorations(p);

    Object.keys(DECORATIONS).forEach(function (id) {
      if (DECORATIONS[id].type === 'unlock' &&
          p.decorations.owned.indexOf(id) === -1 &&
          decorationUnlockMet(id, p)) {
        p.decorations.owned.push(id);
        unlocked.push(id);
      }
    });
    return { player: p, unlocked: unlocked };
  }

  /**
   * 장식을 슬롯에 배치 (다른 슬롯에 있었으면 이동)
   * @returns {{player: object, events: string[]}}
   */
  function placeDecoration(player, id, slotIndex) {
    const p = _clone(player);
    const events = [];
    _ensureDecorations(p);

    if (!DECORATIONS[id] || slotIndex < 0 || slotIndex > 2 ||
        p.decorations.owned.indexOf(id) === -1) {
      events.push('invalid');
      return { player: p, events: events };
    }

    p.decorations.slots = p.decorations.slots.map(function (s) { return s === id ? null : s; });
    p.decorations.slots[slotIndex] = id;
    events.push('deco_placed');
    return { player: p, events: events };
  }

  /** 슬롯 비우기 */
  function removeDecoration(player, slotIndex) {
    const p = _clone(player);
    _ensureDecorations(p);
    p.decorations.slots[slotIndex] = null;
    return { player: p, events: ['deco_removed'] };
  }

  /**
   * 도감 발견 목록 — 별도 저장 없이 앨범 + 현재 달팽이에서 파생한다
   * @returns {string[]} 발견한 변이 id 목록
   */
  function discoveredVariants(album, snails) {
    const found = {};
    (album || []).forEach(function (record) {
      if (record.color) found[record.color] = true;
    });
    (Array.isArray(snails) ? snails : [snails]).forEach(function (s) {
      if (s && s.stage !== 'egg' && s.color) found[s.color] = true;
    });
    return Object.keys(VARIANTS).filter(function (key) { return found[key]; });
  }

  // ── 탐험 ──────────────────────────────────────────────

  function _exploreFor(player, todayKey) {
    const e = player.explore;
    if (e && e.date === todayKey) return _clone(e);
    return { date: todayKey, searches: 0 };
  }

  /** 하루 최대 뒤지기 횟수 (양육자 레벨 보너스 포함) */
  function exploreMaxSearches(player) {
    const lv = keeperLevel(player);
    let max = CONFIG.EXPLORE_SEARCHES_PER_DAY;
    CONFIG.KEEPER_STAMINA_LEVELS.forEach(function (gate) {
      if (lv >= gate) max += 2;
    });
    return max;
  }

  /** 오늘 남은 뒤지기 횟수 */
  function exploreStamina(player, todayKey) {
    return Math.max(0, exploreMaxSearches(player) - _exploreFor(player, todayKey).searches);
  }

  /** 맵 입장 가능 여부 (연못: 2세대 도달 또는 코인 해금) */
  function mapAvailable(player, mapId) {
    const map = EXPLORE_MAPS[mapId];
    if (!map) return false;
    if (!map.locked) return true;
    return (player.generation || 1) >= CONFIG.DECO_GENERATION_REQUIRED ||
      (player.unlocked_maps || []).indexOf(mapId) !== -1;
  }

  /** 잠긴 맵 코인 해금 */
  function buyMapUnlock(player, mapId) {
    const p = _clone(player);
    const events = [];
    if (!EXPLORE_MAPS[mapId] || mapAvailable(p, mapId)) {
      events.push('invalid');
      return { player: p, events: events };
    }
    if (p.coins < CONFIG.EXPLORE_MAP_PRICE) {
      events.push('not_enough_coins');
      return { player: p, events: events };
    }
    p.coins -= CONFIG.EXPLORE_MAP_PRICE;
    p.unlocked_maps = (p.unlocked_maps || []).concat([mapId]);
    events.push('map_unlocked');
    return { player: p, events: events };
  }

  /** 야생 알 변이: 맵 특산 강화(+10%p) + 연못 황금 2배 (전부 brown에서 이동) */
  function wildEggVariant(mapId, generation, rng) {
    const map = EXPLORE_MAPS[mapId];
    const table = variantTableFor(generation);

    const shift = Math.min(0.10, table.brown.chance - 0.05);
    table.brown.chance -= shift;
    table[map.variantBoost].chance += shift;

    if (map.goldenMult) {
      const extra = Math.min(table.golden.chance * (map.goldenMult - 1), table.brown.chance - 0.05);
      table.brown.chance -= extra;
      table.golden.chance += extra;
    }
    return _pickWeighted(table, (rng || Math.random)());
  }

  /**
   * 뒤지기 1회: 스태미나 차감 + 결과 판정 (코인 55% / 상추 25% / 꽝 15% / 야생 알 5%).
   * 야생 알의 슬롯 검사·수용은 호출부 책임 (가득이면 convertWildEgg).
   * @returns {{player: object, result: object|null, events: string[]}}
   */
  function explore(player, mapId, todayKey, rng) {
    const p = _clone(player);
    const events = [];
    const random = rng || Math.random;

    if (!mapAvailable(p, mapId)) {
      events.push('map_locked');
      return { player: p, result: null, events: events };
    }
    const stamina = _exploreFor(p, todayKey);
    if (stamina.searches >= exploreMaxSearches(p)) {
      events.push('no_stamina');
      return { player: p, result: null, events: events };
    }

    stamina.searches += 1;
    p.explore = stamina;

    const roll = random();
    let result;
    if (roll < 0.55) {
      const amount = CONFIG.EXPLORE_COIN_MIN +
        Math.floor(random() * (CONFIG.EXPLORE_COIN_MAX - CONFIG.EXPLORE_COIN_MIN + 1));
      p.coins += amount;
      result = { type: 'coins', amount: amount };
    } else if (roll < 0.80) {
      const amount = 1 + Math.floor(random() * 2);
      _grantLettuce(p, amount);
      result = { type: 'food', amount: amount };
    } else if (roll < 0.95) {
      result = { type: 'none' };
    } else {
      result = { type: 'egg', variant: wildEggVariant(mapId, p.generation || 1, random) };
      events.push('wild_egg');
    }

    events.push('explored');
    return { player: p, result: result, events: events };
  }

  /** 보금자리 가득 시 야생 알 → 코인 전환 */
  function convertWildEgg(player) {
    const p = _clone(player);
    p.coins += CONFIG.WILD_EGG_FALLBACK_COINS;
    return { player: p, events: ['wild_egg_converted'] };
  }

  /** 새 알 레코드 (id는 DB.Snails.add가 부여) */
  function _newEgg(nowISO) {
    return {
      name: '',
      level: 0,
      exp: 0,
      hunger: 0,
      happiness: 100,
      stage: 'egg',
      color: 'brown',
      personality: null,
      wild_variant: null,
      pos: { rx: 0.5, ry: 0.5 },
      created_at: nowISO
    };
  }

  /**
   * 달팽이 알 구매 = 보금자리(슬롯) 확장 + 알 즉시 도착 (최대 MAX_SNAILS)
   * @returns {{player: object, egg: object|null, events: string[]}}
   */
  function buyEggSlot(player, nowISO) {
    const p = _clone(player);
    const events = [];
    const slots = p.snail_slots || 1;

    if (slots >= CONFIG.MAX_SNAILS) {
      events.push('max_slots');
      return { player: p, egg: null, events: events };
    }
    const price = CONFIG.EGG_SLOT_PRICES[slots];
    if (p.coins < price) {
      events.push('not_enough_coins');
      return { player: p, egg: null, events: events };
    }

    p.coins -= price;
    p.snail_slots = slots + 1;
    events.push('egg_bought');
    return { player: p, egg: _newEgg(nowISO), events: events };
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

    events.push('graduated');
    return { snail: _newEgg(nowISO), player: p, record: record, events: events };
  }

  /**
   * 먹이 주기: 상추 1 소모 → 배고픔 감소 + 경험치/행복/코인 증가
   * @returns {{snail: object, player: object, events: string[]}}
   */
  /**
   * 먹이 주기 — 종류별 효과 (FOOD_DEFS)
   * @param {string} [foodId] 생략 시 player.selected_food
   * @returns {{snail, player, food(사용한 정의), events}}
   */
  function feed(snail, player, foodId) {
    let s = _clone(snail);
    const p = _clone(player);
    let events = [];
    const admin = p.admin === true; // 관리자: 배고픔/재고/해금 제약 없음

    const fid = foodId || p.selected_food || 'lettuce';
    const def = FOOD_DEFS[fid] || FOOD_DEFS.lettuce;
    if (!p.foods) p.foods = { lettuce: 0 };

    if (s.stage === 'egg') {
      events.push('not_hatched');
      return { snail: s, player: p, food: def, events: events };
    }
    if (!admin && (p.foods[def.id] || 0) < 1) {
      events.push('no_food');
      return { snail: s, player: p, food: def, events: events };
    }
    if (!admin && s.hunger <= 0) {
      events.push('not_hungry');
      return { snail: s, player: p, food: def, events: events };
    }

    if ((p.foods[def.id] || 0) > 0) p.foods[def.id] -= 1;
    p.coins += CONFIG.FEED_COINS;
    const fx = decorationEffects(p); // 버섯: 회복 +10%
    s.hunger = _clamp(s.hunger - Math.round(def.hunger * fx.feedHungerMult));
    s.happiness = _clamp(s.happiness + def.happiness);
    events.push('fed');

    const grown = gainExp(s, def.exp * (admin ? CONFIG.ADMIN_EXP_MULT : 1));
    s = grown.snail;
    events = events.concat(grown.events);

    return { snail: s, player: p, food: def, events: events };
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
    if (food > 0) _grantLettuce(p, food);
    p.last_daily_reward = todayKey;
    events.push('daily_claimed');
    if (food > 0) events.push('streak_weekly');
    return { player: p, events: events, coins: coins, food: food, streak: count };
  }

  /** 오늘 날짜 기준 미션 상태 (지난 날짜면 초기 상태 반환) */
  function _missionsFor(player, todayKey) {
    const m = player.missions;
    if (m && m.date === todayKey) return _clone(m);
    const fresh = { date: todayKey, bonus_given: false };
    Object.keys(MISSION_DEFS).forEach(function (k) { fresh[k] = 0; });
    return fresh;
  }

  /**
   * 미션 진행 기록 + 달성/완주 보상 자동 지급
   * @param {string} kind 'feed' | 'pet'
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
      p.mission_completions = (p.mission_completions || 0) + 1; // 장식 해금 조건 누적
      events.push('mission_all_done');
    }

    p.coins += coins;
    if (food > 0) _grantLettuce(p, food);
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
   * @param {object} [mods] 장식 패시브 수정치 (decorationEffects — 생략 시 무보정)
   * @returns {{snail: object, events: string[], intervals: number}}
   */
  function applyTimeDecay(snail, lastSeenISO, nowISO, mods) {
    const s = _clone(snail);
    const events = [];
    const fx = mods || { hungerDecayMult: 1, happinessDecayMult: 1 };

    if (s.stage === 'egg' || !lastSeenISO) {
      return { snail: s, events: events, intervals: 0 };
    }

    const elapsedMin = (new Date(nowISO) - new Date(lastSeenISO)) / 60000;
    const intervals = Math.floor(elapsedMin / CONFIG.DECAY_INTERVAL_MIN);
    if (intervals <= 0) {
      return { snail: s, events: events, intervals: 0 };
    }

    s.hunger = _clamp(s.hunger + Math.round(intervals * CONFIG.DECAY_HUNGER * (fx.hungerDecayMult || 1)));
    s.happiness = _clamp(s.happiness - Math.round(intervals * CONFIG.DECAY_HAPPINESS * (fx.happinessDecayMult || 1)));
    events.push('decayed');
    return { snail: s, events: events, intervals: intervals };
  }

  /**
   * 쓰다듬기: 행복 상승 (쿨다운 없음 — 언제든 가능)
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

    const fx = decorationEffects(p); // 들꽃: 쓰다듬기 행복 +3
    s.happiness = _clamp(s.happiness + CONFIG.PET_HAPPINESS + fx.petHappinessBonus);
    events.push('petted');
    return { snail: s, player: p, events: events };
  }

  /**
   * 부재 정산 통합 (멀티 달팽이): 개체별 시간 감쇠 + 계정 단위 발견.
   * @param {object[]} snails 달팽이 목록 (단일 객체도 허용)
   * @param {Function} [rng] 난수 함수 주입 (테스트에서 시드 고정용)
   * @returns {{snails: object[], player: object, report: object, events: string[]}}
   */
  function summarizeAway(snails, player, nowISO, rng) {
    const random = rng || Math.random;
    const list = (Array.isArray(snails) ? snails : [snails]).map(_clone);
    const p = _clone(player);
    const events = [];
    const report = { away_minutes: 0, snails: [], finds: [] };

    const hasHatched = list.some(function (s) { return s.stage !== 'egg'; });
    if (!hasHatched || !p.last_seen) {
      return { snails: list, player: p, report: report, events: events };
    }

    report.away_minutes = Math.max(0, Math.floor((new Date(nowISO) - new Date(p.last_seen)) / 60000));

    // 1) 개체별 시간 감쇠 (last_seen은 적용 구간만큼만 전진 — 잔여 시간 보존)
    const decoFx = decorationEffects(p);
    let intervals = 0;
    const updated = list.map(function (s) {
      const decay = applyTimeDecay(s, p.last_seen, nowISO, decoFx);
      if (decay.intervals > 0) {
        intervals = Math.max(intervals, decay.intervals);
        report.snails.push({
          id: s.id,
          name: s.name,
          hunger_delta: decay.snail.hunger - s.hunger,
          happiness_delta: decay.snail.happiness - s.happiness
        });
      }
      return decay.snail;
    });
    if (intervals > 0) {
      p.last_seen = new Date(
        new Date(p.last_seen).getTime() + intervals * CONFIG.DECAY_INTERVAL_MIN * 60 * 1000
      ).toISOString();
      events.push('decayed');
    }

    // 2) 부재 중 발견 (계정 단위) — FIND_INTERVAL_HOURS마다 1회 판정, 최대 FIND_MAX건
    const chances = Math.floor(report.away_minutes / (CONFIG.FIND_INTERVAL_HOURS * 60));
    for (let i = 0; i < chances && report.finds.length < CONFIG.FIND_MAX; i++) {
      if (random() >= CONFIG.FIND_CHANCE) continue;
      if (random() < CONFIG.FIND_FOOD_CHANCE) {
        _grantLettuce(p, 1);
        report.finds.push({ type: 'food', amount: 1 });
      } else {
        const amount = CONFIG.FIND_COIN_MIN +
          Math.floor(random() * (CONFIG.FIND_COIN_MAX - CONFIG.FIND_COIN_MIN + 1));
        p.coins += amount;
        report.finds.push({ type: 'coins', amount: amount });
      }
      events.push('found_item');
    }

    return { snails: updated, player: p, report: report, events: events };
  }

  /** 먹이 가격 (묶음은 10% 할인) */
  function foodPrice(foodId, count) {
    const def = FOOD_DEFS[foodId];
    const n = count || 1;
    if (n === CONFIG.FOOD_BUNDLE_COUNT) {
      return Math.round(def.price * n * CONFIG.FOOD_BUNDLE_DISCOUNT);
    }
    return def.price * n;
  }

  /**
   * 먹이 구매 (종류/묶음 지원)
   * @returns {{player: object, events: string[]}}
   */
  function buyFood(player, foodId, count) {
    const p = _clone(player);
    const events = [];
    const fid = foodId || 'lettuce';
    const def = FOOD_DEFS[fid];
    const n = count || 1;

    if (!def) {
      events.push('invalid');
      return { player: p, events: events };
    }
    if (!foodUnlocked(p, fid)) {
      events.push('food_locked');
      return { player: p, events: events };
    }
    const price = foodPrice(fid, n);
    if (p.coins < price) {
      events.push('not_enough_coins');
      return { player: p, events: events };
    }

    p.coins -= price;
    if (!p.foods) p.foods = {};
    p.foods[fid] = (p.foods[fid] || 0) + n;
    events.push('food_bought');
    return { player: p, events: events };
  }

  return {
    CONFIG: CONFIG,
    STAGES: STAGES,
    WEATHER: WEATHER,
    PERSONALITIES: PERSONALITIES,
    VARIANTS: VARIANTS,
    RARITIES: RARITIES,
    spritePath: spritePath,
    DECORATIONS: DECORATIONS,
    decorationEffects: decorationEffects,
    MISSION_DEFS: MISSION_DEFS,
    FOOD_DEFS: FOOD_DEFS,
    keeperLevel: keeperLevel,
    keeperXpToNext: keeperXpToNext,
    gainKeeperXp: gainKeeperXp,
    foodUnlocked: foodUnlocked,
    foodPrice: foodPrice,
    exploreMaxSearches: exploreMaxSearches,
    EXPLORE_MAPS: EXPLORE_MAPS,
    exploreStamina: exploreStamina,
    mapAvailable: mapAvailable,
    buyMapUnlock: buyMapUnlock,
    wildEggVariant: wildEggVariant,
    explore: explore,
    convertWildEgg: convertWildEgg,
    newEgg: _newEgg,
    decorationUnlockMet: decorationUnlockMet,
    buyDecoration: buyDecoration,
    claimDecorationUnlocks: claimDecorationUnlocks,
    placeDecoration: placeDecoration,
    removeDecoration: removeDecoration,
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
    pet: pet,
    applyTimeDecay: applyTimeDecay,
    summarizeAway: summarizeAway,
    buyFood: buyFood,
    buyEggSlot: buyEggSlot
  };
})();
