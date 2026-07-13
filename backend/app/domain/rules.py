"""게임 규칙 — js/game.js의 순수 함수를 이식한 단일 판정 소스.

수치를 바꿀 때는 반드시 docs/N차_MVP_구현계획.md를 먼저 갱신한다.
클라이언트는 GET /v1/game/config로 표시용 수치를 받는다 (여기와 어긋나면 안 됨).
모든 확률은 rng 주입식(기본 random.random)이라 테스트에서 결정적으로 검증한다.
"""
import random
from datetime import datetime, timedelta

CONFIG = {
    # 시간 감쇠 (1시간마다)
    "DECAY_INTERVAL_MIN": 60,
    "DECAY_HUNGER": 7,
    "DECAY_HAPPINESS": 5,
    # 먹이/보상
    "FEED_COINS": 2,
    "FOOD_BUNDLE_COUNT": 10,
    "FOOD_BUNDLE_DISCOUNT": 0.9,
    "DAILY_COINS": 20,
    "STREAK_BONUS_PER_DAY": 2,
    "STREAK_BONUS_CAP": 20,
    "STREAK_WEEKLY_FOOD": 3,
    # 미션
    "MISSION_REWARD_COINS": 10,
    "MISSION_BONUS_COINS": 20,
    "MISSION_BONUS_FOOD": 1,
    # 쓰다듬기
    "PET_HAPPINESS": 5,
    # 성장
    "EXP_PER_LEVEL": 5,
    "HATCH_HUNGER": 40,
    "HATCH_HAPPINESS": 80,
    # 여행/세대
    "GRADUATE_MIN_LEVEL": 20,
    "GRADUATE_COINS": 100,
    "GENERATION_BOOST_CAP": 5,
    # 졸업 달팽이 엽서 이벤트 (하루 1회, 마리당 독립 확률)
    "LETTER_CHANCE": 0.01,
    "LETTER_COINS": 10,
    "LETTER_MAX_PER_DAY": 3,       # 하루 최대 편지 수(스팸 가드)
    # 슬롯 (9차에서 8마리로 확장 예정 — MAX는 config/env)
    "EGG_SLOT_PRICES": [0, 500, 1500, 3000, 5000, 8000, 12000, 20000],
    "EGG_SLOT_LEVELS": [0, 2, 4, 6, 8, 10, 12, 14],
    # 부재 중 발견
    "FIND_INTERVAL_HOURS": 4,
    "FIND_CHANCE": 0.35,
    "FIND_MAX": 2,
    "FIND_COIN_MIN": 5,
    "FIND_COIN_MAX": 15,
    "FIND_FOOD_CHANCE": 0.3,
    # 탐험
    # 미니게임 — 달팽이 경주
    "RACE_LANES": 5,
    "RACE_REWARD": 10,
    "RACE_MAX_PER_DAY": 3,
    "RACE_TIME_MIN": 8.0,
    "RACE_TIME_MAX": 10.5,
    # 미니게임 — 달팽이 퀴즈
    "QUIZ_REWARD": 5,
    "QUIZ_MAX_PER_DAY": 3,
    # 도감 등급 완성 보상 (등급별 1회, 수령 멱등 — 13차 §B.4)
    "DEX_TIER_REWARDS": {"common": 100, "rare": 30, "epic": 200},
    "EXPLORE_SEARCHES_PER_DAY": 10,
    "EXPLORE_COIN_MIN": 3,
    "EXPLORE_COIN_MAX": 12,
    "EXPLORE_MAP_PRICE": 1000,
    "WILD_EGG_FALLBACK_COINS": 30,
    # 양육자
    "KEEPER_XP": {
        "feed": 2, "explore": 1, "daily": 5, "mission": 5,
        "mission_all": 10, "hatch": 15, "graduate": 30, "dex_new": 25,
    },
    "KEEPER_LEVEL_COIN_MULT": 30,
    "KEEPER_STAMINA_LEVELS": [5, 8],
    # 장식 해금
    "DECO_MISSIONS_REQUIRED": 7,
    "DECO_GENERATION_REQUIRED": 2,
}

FOOD_DEFS = {
    "lettuce": {"id": "lettuce", "label": "상추", "emoji": "🥬", "price": 10, "hunger": 30, "exp": 22, "happiness": 5, "unlockLevel": 1},
    "carrot": {"id": "carrot", "label": "당근", "emoji": "🥕", "price": 18, "hunger": 45, "exp": 28, "happiness": 5, "unlockLevel": 2},
    "apple": {"id": "apple", "label": "사과", "emoji": "🍎", "price": 30, "hunger": 35, "exp": 32, "happiness": 12, "unlockLevel": 4},
    "salad": {"id": "salad", "label": "특제 샐러드", "emoji": "🥗", "price": 60, "hunger": 100, "exp": 52, "happiness": 15, "unlockLevel": 6},
}

# 등급: 갈색/적갈색/회갈색 = 기본(common), 올리브 = 레어(rare), 황금 = 에픽(epic)
VARIANTS = {
    "brown": {"label": "갈색", "chance": 0.088, "rarity": "common"},
    "gray": {"label": "회갈색", "chance": 0.088, "rarity": "common"},
    "red": {"label": "붉은색", "chance": 0.088, "rarity": "common"},
    "yellow": {"label": "노란색", "chance": 0.088, "rarity": "common"},
    "bluegray": {"label": "블루그레이", "chance": 0.088, "rarity": "common"},
    "lavender": {"label": "라벤더그레이", "chance": 0.088, "rarity": "common"},
    "herb": {"label": "허브", "chance": 0.088, "rarity": "common"},
    "black": {"label": "검정", "chance": 0.088, "rarity": "common"},
    "lime": {"label": "라임", "chance": 0.088, "rarity": "common"},
    "sky": {"label": "소라", "chance": 0.088, "rarity": "common"},
    "pond": {"label": "연못", "chance": 0.02, "rarity": "rare"},
    "maple": {"label": "단풍", "chance": 0.02, "rarity": "rare"},
    "pinwheel": {"label": "바람개비", "chance": 0.02, "rarity": "rare"},
    "cherry": {"label": "벚꽃", "chance": 0.02, "rarity": "rare"},
    "sunflower": {"label": "해바라기", "chance": 0.02, "rarity": "rare"},
    "bee": {"label": "꿀벌", "chance": 0.005, "rarity": "epic"},
    "devil": {"label": "악마", "chance": 0.005, "rarity": "epic"},
    "angel": {"label": "천사", "chance": 0.005, "rarity": "epic"},
    "ladybug": {"label": "무당벌레", "chance": 0.005, "rarity": "epic"},
}
# 세대 보정: 연못(레어)이 세대마다 오르고 기본 10종이 균등하게 조금씩 내린다 (합계 0). 그 외 무보정
VARIANT_GEN_DELTA = {
    "brown": -0.1, "gray": -0.1, "red": -0.1, "yellow": -0.1, "bluegray": -0.1,
    "lavender": -0.1, "herb": -0.1, "black": -0.1, "lime": -0.1, "sky": -0.1,
    "pond": 1.0, "maple": 0, "pinwheel": 0, "cherry": 0, "sunflower": 0,
    "bee": 0, "devil": 0, "angel": 0, "ladybug": 0,
}

RARITIES = ("common", "rare", "epic")


def dex_completed_tiers(discovered) -> list[str]:
    """발견 변이 목록으로 '완성된' 등급 id 목록을 반환한다 (순수). 변이 없는 등급은 제외."""
    found = set(discovered or [])
    out = []
    for tier in RARITIES:
        keys = [k for k, v in VARIANTS.items() if v["rarity"] == tier]
        if keys and all(k in found for k in keys):
            out.append(tier)
    return out


PERSONALITIES = {"foodie": 0.40, "explorer": 0.35, "sleepy": 0.25}

DECORATIONS = {
    "pebble": {"label": "조약돌", "type": "buy", "price": 50},
    "mushroom": {"label": "버섯", "type": "buy", "price": 80},
    "wildflower": {"label": "들꽃", "type": "unlock"},
    "mossrock": {"label": "이끼 바위", "type": "unlock"},
}

EXPLORE_MAPS = {
    "moss": {"variant_boost": "lime", "locked": False},
    "field": {"variant_boost": "red", "locked": False},
    "pond": {"variant_boost": "gray", "rare_mult": 2, "locked": True},  # 연못 맵 → 연못(레어) 부스트
}

MISSION_DEFS = {"feed": 2, "pet": 1, "explore": 1}

STAGE_LEVELS = {"junior": 10, "adult": 20}  # 외형 변화 Lv1(baby)/10(junior)/20(adult)


def clamp(v: float) -> float:
    return max(0.0, min(100.0, v))


# ── 성장 ────────────────────────────────────────────────

def exp_to_next(level: int) -> int:
    return level * CONFIG["EXP_PER_LEVEL"]


def stage_for_level(level: int) -> str:
    if level >= STAGE_LEVELS["adult"]:
        return "adult"
    if level >= STAGE_LEVELS["junior"]:
        return "junior"
    return "baby"


def gain_exp(snail: dict, amount: int) -> list[dict]:
    """snail(dict)을 제자리 갱신하고 events 반환."""
    events: list[dict] = []
    if snail["stage"] == "egg":
        return events
    snail["exp"] += amount
    while snail["exp"] >= exp_to_next(snail["level"]):
        snail["exp"] -= exp_to_next(snail["level"])
        snail["level"] += 1
        events.append({"type": "levelup", "snailId": snail["id"], "level": snail["level"]})
        next_stage = stage_for_level(snail["level"])
        if next_stage != snail["stage"]:
            snail["stage"] = next_stage
            events.append({"type": "stage_up", "snailId": snail["id"], "stage": next_stage})
    return events


# ── 변이/성격 ───────────────────────────────────────────

def variant_table_for(generation: int, hour: int | None = None) -> dict[str, float]:
    boost = min(max(generation - 1, 0), CONFIG["GENERATION_BOOST_CAP"])
    table = {
        key: (base["chance"] * 100 + VARIANT_GEN_DELTA[key] * boost) / 100
        for key, base in VARIANTS.items()
    }
    # 히든 변이 시간 조건: 천사=낮(06~18)만, 악마=밤(18~06)만. 안 맞는 시간대의 확률은 갈색으로.
    if hour is not None:
        daytime = 6 <= hour < 18
        blocked = "devil" if daytime else "angel"
        if table.get(blocked):
            table["brown"] += table[blocked]
            table[blocked] = 0
    return table


def _pick_weighted(table: dict[str, float], roll: float) -> str:
    acc = 0.0
    keys = list(table.keys())
    for key in keys:
        acc += table[key]
        if roll < acc:
            return key
    return keys[-1]


def roll_variant(generation: int, rng=random.random, hour: int | None = None) -> str:
    return _pick_weighted(variant_table_for(generation, hour), rng())


def roll_personality(rng=random.random) -> str:
    return _pick_weighted(PERSONALITIES, rng())


def wild_egg_variant(map_id: str, generation: int, rng=random.random) -> str:
    m = EXPLORE_MAPS[map_id]
    table = variant_table_for(generation)
    shift = min(0.10, table["brown"] - 0.05)
    table["brown"] -= shift
    table[m["variant_boost"]] += shift
    if m.get("rare_mult"):
        extra = min(table["pond"] * (m["rare_mult"] - 1), table["brown"] - 0.05)
        table["brown"] -= extra
        table["pond"] += extra
    return _pick_weighted(table, rng())


# ── 시간 감쇠 (lazy — 배치 없음) ────────────────────────

def apply_decay(snail: dict, now: datetime, deco_fx: dict) -> tuple[int, list[dict]]:
    """last_state_at 기준 경과 구간만 적용, 잔여 시간은 last_state_at 보존으로 유지."""
    events: list[dict] = []
    if snail["stage"] == "egg":
        return 0, events
    elapsed_min = (now - snail["last_state_at"]).total_seconds() / 60
    intervals = int(elapsed_min // CONFIG["DECAY_INTERVAL_MIN"])
    if intervals <= 0:
        return 0, events
    snail["hunger"] = clamp(snail["hunger"] + round(intervals * CONFIG["DECAY_HUNGER"] * deco_fx["hungerDecayMult"]))
    snail["happiness"] = clamp(snail["happiness"] - round(intervals * CONFIG["DECAY_HAPPINESS"] * deco_fx["happinessDecayMult"]))
    snail["last_state_at"] = snail["last_state_at"] + timedelta(minutes=intervals * CONFIG["DECAY_INTERVAL_MIN"])
    events.append({"type": "decayed", "snailId": snail["id"]})
    return intervals, events


def decoration_effects(slots: list) -> dict:
    slots = slots or []
    return {
        "happinessDecayMult": 0.85 if "pebble" in slots else 1.0,
        "feedHungerMult": 1.1 if "mushroom" in slots else 1.0,
        "petHappinessBonus": 3 if "wildflower" in slots else 0,
        "hungerDecayMult": 0.9 if "mossrock" in slots else 1.0,
    }


# ── 양육자 ──────────────────────────────────────────────

def keeper_xp_to_next(level: int) -> int:
    return 50 + (level - 1) * 25


def gain_keeper_xp(user: dict, action: str) -> tuple[int, list[dict]]:
    """user dict 제자리 갱신, (레벨업 보상 코인, events) 반환."""
    amount = CONFIG["KEEPER_XP"].get(action, 0)
    events: list[dict] = []
    coins = 0
    if amount <= 0:
        return 0, events
    user["keeper_xp"] += amount
    events.append({"type": "keeper_xp_gained", "amount": amount})
    while user["keeper_xp"] >= keeper_xp_to_next(user["keeper_level"]):
        user["keeper_xp"] -= keeper_xp_to_next(user["keeper_level"])
        user["keeper_level"] += 1
        coins += CONFIG["KEEPER_LEVEL_COIN_MULT"] * user["keeper_level"]
        events.append({"type": "keeper_levelup", "level": user["keeper_level"], "coins": CONFIG["KEEPER_LEVEL_COIN_MULT"] * user["keeper_level"]})
    user["coins"] += coins
    return coins, events


def food_unlocked(keeper_level: int, food_id: str) -> bool:
    d = FOOD_DEFS.get(food_id)
    return bool(d) and keeper_level >= d["unlockLevel"]


def food_price(food_id: str, count: int) -> int:
    d = FOOD_DEFS[food_id]
    if count == CONFIG["FOOD_BUNDLE_COUNT"]:
        return round(d["price"] * count * CONFIG["FOOD_BUNDLE_DISCOUNT"])
    return d["price"] * count


def explore_max_searches(keeper_level: int) -> int:
    return CONFIG["EXPLORE_SEARCHES_PER_DAY"] + sum(2 for g in CONFIG["KEEPER_STAMINA_LEVELS"] if keeper_level >= g)


# ── 스트릭/미션 (날짜 키는 사용자 타임존 기준 — 서버가 계산) ──

def prev_day_key(date_key: str) -> str:
    d = datetime.strptime(date_key, "%Y-%m-%d") - timedelta(days=1)
    return d.strftime("%Y-%m-%d")


def apply_streak(user: dict, today_key: str) -> tuple[dict, list[dict]]:
    """접속 보상 + 스트릭. 반환: ({coins, food}, events)"""
    events: list[dict] = []
    if user.get("last_daily_reward") == today_key:
        return {"coins": 0, "food": 0}, events
    count = user.get("streak_count", 0) + 1 if user.get("streak_last_date") == prev_day_key(today_key) else 1
    user["streak_count"] = count
    user["streak_last_date"] = today_key
    bonus = min((count - 1) * CONFIG["STREAK_BONUS_PER_DAY"], CONFIG["STREAK_BONUS_CAP"])
    coins = CONFIG["DAILY_COINS"] + bonus
    food = CONFIG["STREAK_WEEKLY_FOOD"] if count % 7 == 0 else 0
    user["coins"] += coins
    user["last_daily_reward"] = today_key
    events.append({"type": "daily_claimed", "coins": coins, "streak": count, "food": food})
    return {"coins": coins, "food": food}, events


def missions_for(user: dict, today_key: str) -> dict:
    m = user.get("missions") or {}
    if m.get("date") == today_key:
        return dict(m)
    return {"date": today_key, "feed": 0, "pet": 0, "explore": 0, "bonus_given": False}


def record_mission(user: dict, kind: str, today_key: str) -> tuple[dict, list[dict]]:
    """미션 진행 + 자동 보상. 반환: ({coins, food}, events)"""
    events: list[dict] = []
    coins = 0
    food = 0
    if kind not in MISSION_DEFS:
        return {"coins": 0, "food": 0}, events
    m = missions_for(user, today_key)
    done_before = m[kind] >= MISSION_DEFS[kind]
    m[kind] += 1
    if not done_before and m[kind] >= MISSION_DEFS[kind]:
        coins += CONFIG["MISSION_REWARD_COINS"]
        events.append({"type": "mission_done", "mission": kind, "coins": CONFIG["MISSION_REWARD_COINS"]})
    if not m["bonus_given"] and all(m[k] >= MISSION_DEFS[k] for k in MISSION_DEFS):
        m["bonus_given"] = True
        coins += CONFIG["MISSION_BONUS_COINS"]
        food += CONFIG["MISSION_BONUS_FOOD"]
        user["mission_completions"] = user.get("mission_completions", 0) + 1
        events.append({"type": "mission_all_done", "coins": CONFIG["MISSION_BONUS_COINS"], "food": CONFIG["MISSION_BONUS_FOOD"]})
    user["coins"] += coins
    user["missions"] = m
    return {"coins": coins, "food": food}, events


# ── 행동 ────────────────────────────────────────────────

def feed(snail: dict, food_id: str, foods: dict, deco_slots: list) -> tuple[dict, list[dict]]:
    """검증 통과 시 snail/foods 제자리 갱신. 반환: (사용한 def, events). 실패는 ValueError(code)."""
    d = FOOD_DEFS.get(food_id)
    if not d:
        raise ValueError("invalid_food")
    if snail["stage"] == "egg":
        raise ValueError("not_hatched")
    if snail.get("graduated_at"):
        raise ValueError("graduated")
    if foods.get(food_id, 0) < 1:
        raise ValueError("no_food")
    if snail["hunger"] <= 0:
        raise ValueError("not_hungry")

    foods[food_id] -= 1
    fx = decoration_effects(deco_slots)
    snail["hunger"] = clamp(snail["hunger"] - round(d["hunger"] * fx["feedHungerMult"]))
    snail["happiness"] = clamp(snail["happiness"] + d["happiness"])
    events = [{"type": "fed", "snailId": snail["id"], "food": food_id, "exp": d["exp"]}]
    events += gain_exp(snail, d["exp"])
    return d, events


def pet(snail: dict, deco_slots: list) -> list[dict]:
    if snail["stage"] == "egg":
        raise ValueError("not_hatched")
    if snail.get("graduated_at"):
        raise ValueError("graduated")
    fx = decoration_effects(deco_slots)
    snail["happiness"] = clamp(snail["happiness"] + CONFIG["PET_HAPPINESS"] + fx["petHappinessBonus"])
    return [{"type": "petted", "snailId": snail["id"]}]


def hatch(snail: dict, name: str, generation: int, rng=random.random, hour: int | None = None) -> list[dict]:
    if snail["stage"] != "egg":
        raise ValueError("already_hatched")
    name = (name or "").strip()[:12]
    if not name:
        raise ValueError("name_required")
    snail["name"] = name
    snail["stage"] = "baby"
    snail["level"] = 1
    snail["exp"] = 0
    snail["hunger"] = CONFIG["HATCH_HUNGER"]
    snail["happiness"] = CONFIG["HATCH_HAPPINESS"]
    snail["personality"] = roll_personality(rng)
    snail["color"] = snail.get("wild_variant") or roll_variant(generation, rng, hour)
    snail["wild_variant"] = None
    return [{"type": "hatched", "snailId": snail["id"], "color": snail["color"], "personality": snail["personality"]}]


def can_graduate(snail: dict) -> bool:
    return snail["stage"] == "adult" and snail["level"] >= CONFIG["GRADUATE_MIN_LEVEL"] and not snail.get("graduated_at")


def egg_slot_price(current_slots: int) -> int | None:
    prices = CONFIG["EGG_SLOT_PRICES"]
    if current_slots >= len(prices):
        return None
    return prices[current_slots]


def egg_slot_level(current_slots: int) -> int:
    """다음 슬롯 해금에 필요한 양육자 레벨."""
    levels = CONFIG["EGG_SLOT_LEVELS"]
    return levels[current_slots] if current_slots < len(levels) else 999


# ── 부재 발견 / 탐험 ────────────────────────────────────

def away_finds(away_minutes: float, rng=random.random) -> list[dict]:
    finds: list[dict] = []
    chances = int(away_minutes // (CONFIG["FIND_INTERVAL_HOURS"] * 60))
    for _ in range(chances):
        if len(finds) >= CONFIG["FIND_MAX"]:
            break
        if rng() >= CONFIG["FIND_CHANCE"]:
            continue
        if rng() < CONFIG["FIND_FOOD_CHANCE"]:
            finds.append({"type": "food", "amount": 1})
        else:
            amount = CONFIG["FIND_COIN_MIN"] + int(rng() * (CONFIG["FIND_COIN_MAX"] - CONFIG["FIND_COIN_MIN"] + 1))
            finds.append({"type": "coins", "amount": amount})
    return finds


# ── 졸업 달팽이 엽서 이벤트 ─────────────────────────────

LETTER_PLACES = ["이끼 계곡", "햇살 들판 너머", "이슬 연못가", "바람 부는 언덕", "버섯 숲", "달빛 호숫가"]
LETTER_TEMPLATES = [
    "{place}에서 잘 지내요! 여비에 보태라고 조금 부쳐요.",
    "여긴 {place}. 낯선 길도 이제 익숙해요. 걱정 말아요!",
    "{place}에서 반짝이는 걸 주웠어요. 절반은 보낼게요.",
]


def roll_letter(name: str, rng=random.random) -> dict | None:
    """졸업 달팽이 1마리의 엽서 판정(독립 확률). 편지 dict 또는 None."""
    if rng() >= CONFIG["LETTER_CHANCE"]:
        return None
    place = LETTER_PLACES[int(rng() * len(LETTER_PLACES))]
    tmpl = LETTER_TEMPLATES[int(rng() * len(LETTER_TEMPLATES))]
    return {
        "title": f"{name}의 여행 엽서 · {place}",
        "body": tmpl.format(place=place),
        "coins": CONFIG["LETTER_COINS"],
    }


def map_available(map_id: str, generation: int, unlocked: list) -> bool:
    m = EXPLORE_MAPS.get(map_id)
    if not m:
        return False
    if not m["locked"]:
        return True
    return generation >= CONFIG["DECO_GENERATION_REQUIRED"] or map_id in (unlocked or [])


# 달팽이 퀴즈 문항 — 정답은 서버가 검증(치트 방지). 클라 game.js와 동일 순서 유지.
QUIZ_BANK = [
    {"q": "달팽이는 몇 시간마다 배고파질까요?", "choices": ["1시간", "3시간", "6시간"], "answer": 0},
    {"q": "레어 등급 달팽이는 무엇일까요?", "choices": ["황금", "연못", "검정"], "answer": 1},
    {"q": "달팽이를 여행 보내려면 몇 레벨이 필요할까요?", "choices": ["Lv.10", "Lv.15", "Lv.20"], "answer": 2},
    {"q": "양육자 레벨을 올리면 무엇이 좋아질까요?", "choices": ["새 먹이 해금", "달팽이가 커짐", "코인 2배"], "answer": 0},
    {"q": "상추를 주면 배고픔이 어떻게 될까요?", "choices": ["늘어요", "줄어요", "그대로예요"], "answer": 1},
    {"q": "달팽이 색은 언제 정해질까요?", "choices": ["부화할 때", "성체가 될 때", "매일 바뀜"], "answer": 0},
]


def quiz_check(index: int, answer: int) -> bool:
    if index < 0 or index >= len(QUIZ_BANK):
        return False
    return QUIZ_BANK[index]["answer"] == answer


def race_roll(rng=random.random) -> dict:
    """달팽이 경주 판정 — 각 레인의 결승 시간(초)을 굴려 가장 빠른 레인이 1등."""
    times = [CONFIG["RACE_TIME_MIN"] + rng() * (CONFIG["RACE_TIME_MAX"] - CONFIG["RACE_TIME_MIN"])
             for _ in range(CONFIG["RACE_LANES"])]
    order = sorted(range(len(times)), key=lambda i: times[i])
    return {"winner": order[0], "order": order, "times": times}


def explore_roll(generation: int, map_id: str, rng=random.random) -> dict:
    # 12차: 달팽이(야생 알) 찾기 제거 — 코인 55% / 상추 25% / 꽝 20%
    roll = rng()
    if roll < 0.55:
        amount = CONFIG["EXPLORE_COIN_MIN"] + int(rng() * (CONFIG["EXPLORE_COIN_MAX"] - CONFIG["EXPLORE_COIN_MIN"] + 1))
        return {"type": "coins", "amount": amount}
    if roll < 0.80:
        return {"type": "food", "amount": 1 + int(rng() * 2)}
    return {"type": "none"}
