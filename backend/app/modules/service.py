"""공용 서비스 — 정산(감쇠/접속 보상/부재 발견), 원장, 직렬화(클라이언트 v6 형태)."""
import random
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..core.errors import ApiError
from ..domain import rules

FOOD_IDS = list(rules.FOOD_DEFS.keys())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    """SQLite는 tz를 벗겨 저장하므로 UTC로 보정한다."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def today_key(user: models.User, now: datetime | None = None) -> str:
    """일일 판정은 사용자 타임존, 시각은 항상 서버 기준."""
    tz = ZoneInfo(user.timezone or "Asia/Seoul")
    return (now or utcnow()).astimezone(tz).strftime("%Y-%m-%d")


# ── 인벤토리/원장 ───────────────────────────────────────

def get_inventory(db: Session, user: models.User) -> dict[str, int]:
    rows = db.execute(select(models.Inventory).where(models.Inventory.user_id == user.id)).scalars()
    return {r.item_id: r.quantity for r in rows}


def set_item(db: Session, user: models.User, item_id: str, quantity: int) -> None:
    if quantity < 0:
        raise ApiError(409, "invariant_violation", "아이템 수량은 음수가 될 수 없습니다.")
    row = db.get(models.Inventory, (user.id, item_id))
    if row is None:
        row = models.Inventory(user_id=user.id, item_id=item_id, quantity=quantity)
        db.add(row)
    else:
        row.quantity = quantity


def add_item(db: Session, user: models.User, item_id: str, delta: int) -> None:
    inv = get_inventory(db, user)
    set_item(db, user, item_id, inv.get(item_id, 0) + delta)


def add_coins(db: Session, user: models.User, amount: int, reason: str, reference_id: str | None = None) -> None:
    """코인 증감은 반드시 이 함수(원장 기록 포함)를 거친다."""
    if amount == 0:
        return
    new_balance = user.coins + amount
    if new_balance < 0:
        raise ApiError(409, "not_enough_coins", "코인이 부족합니다.")
    user.coins = new_balance
    db.add(models.CurrencyLedger(
        user_id=user.id, currency="coins", amount=amount,
        balance_after=new_balance, reason=reason, reference_id=reference_id,
    ))


def add_journal(db: Session, user: models.User, type_: str, text: str) -> None:
    db.add(models.JournalEntry(user_id=user.id, type=type_, text=text))


# ── 도감 파생 ───────────────────────────────────────────

def discovered_variants(db: Session, user: models.User) -> set[str]:
    found: set[str] = set()
    for entry in db.execute(select(models.AlbumEntry.color).where(models.AlbumEntry.user_id == user.id)).scalars():
        found.add(entry)
    for snail in active_snails(db, user):
        if snail.stage != "egg":
            found.add(snail.color)
    return found


def active_snails(db: Session, user: models.User) -> list[models.Snail]:
    """졸업하지 않은(현재 서식지) 달팽이."""
    return list(db.execute(
        select(models.Snail)
        .where(models.Snail.user_id == user.id, models.Snail.graduated_at.is_(None))
        .order_by(models.Snail.created_at)
    ).scalars())


# ── 정산 (상태 조회/행동 직전 lazy) ─────────────────────

def settle(db: Session, user: models.User) -> list[dict]:
    """감쇠 + 접속 보상(스트릭) + 부재 중 발견 + 양육자 daily XP. events 반환."""
    events: list[dict] = []
    now = utcnow()
    deco_fx = rules.decoration_effects(user.decoration_slots)

    # 1) 개체별 감쇠
    for snail in active_snails(db, user):
        s = snail_dict(snail)
        rules.apply_decay(s, now, deco_fx)
        apply_snail_dict(snail, s)

    # 2) 부재 중 발견 (계정 단위, 부화 개체가 있을 때만)
    away_min = (now - _aware(user.last_seen_at)).total_seconds() / 60
    has_hatched = any(s.stage != "egg" for s in active_snails(db, user))
    if has_hatched and away_min >= rules.CONFIG["FIND_INTERVAL_HOURS"] * 60:
        for find in rules.away_finds(away_min):
            if find["type"] == "coins":
                add_coins(db, user, find["amount"], "away_find")
                add_journal(db, user, "find", f"돌아다니다 코인 {find['amount']}개를 주워왔어요!")
            else:
                add_item(db, user, "lettuce", find["amount"])
                add_journal(db, user, "find", "어디선가 상추를 하나 물어왔어요!")
            events.append({"type": "found_item", **find})
    user.last_seen_at = now
    if away_min >= 30:
        events.append({"type": "away_report", "minutes": int(away_min)})

    # 3) 접속 보상 + 스트릭 (+양육자 daily)
    u = user_dict(user)
    reward, streak_events = rules.apply_streak(u, today_key(user, now))
    if streak_events:
        if reward["food"]:
            add_item(db, user, "lettuce", reward["food"])
        _, keeper_events = rules.gain_keeper_xp(u, "daily")
        streak_events += keeper_events
        apply_user_dict(user, u)
        # apply_streak/keeper가 dict에 더한 코인을 원장에 반영
        db.add(models.CurrencyLedger(
            user_id=user.id, currency="coins",
            amount=reward["coins"] + sum(e.get("coins", 0) for e in keeper_events if e["type"] == "keeper_levelup"),
            balance_after=user.coins, reason="daily_streak",
        ))
        events += streak_events
    return events


# ── ORM ↔ dict (도메인 규칙은 dict로만 계산) ────────────

def snail_dict(s: models.Snail) -> dict:
    return {
        "id": s.id, "name": s.name, "stage": s.stage, "level": s.level, "exp": s.exp,
        "hunger": s.hunger, "happiness": s.happiness, "color": s.color,
        "personality": s.personality, "wild_variant": s.wild_variant,
        "last_state_at": _aware(s.last_state_at), "graduated_at": s.graduated_at,
    }


def apply_snail_dict(s: models.Snail, d: dict) -> None:
    s.name, s.stage, s.level, s.exp = d["name"], d["stage"], d["level"], d["exp"]
    s.hunger, s.happiness = d["hunger"], d["happiness"]
    s.color, s.personality, s.wild_variant = d["color"], d["personality"], d["wild_variant"]
    s.last_state_at = d["last_state_at"]
    s.version += 1


def user_dict(u: models.User) -> dict:
    return {
        "coins": u.coins, "keeper_level": u.keeper_level, "keeper_xp": u.keeper_xp,
        "streak_count": u.streak_count, "streak_last_date": u.streak_last_date,
        "last_daily_reward": u.last_daily_reward,
        "missions": dict(u.missions or {}), "mission_completions": u.mission_completions,
    }


def apply_user_dict(u: models.User, d: dict) -> None:
    u.keeper_level, u.keeper_xp = d["keeper_level"], d["keeper_xp"]
    u.streak_count, u.streak_last_date = d["streak_count"], d["streak_last_date"]
    u.last_daily_reward = d["last_daily_reward"]
    u.missions = d["missions"]
    u.mission_completions = d["mission_completions"]
    u.coins = d["coins"]


# ── 클라이언트(v6) 형태 직렬화 ──────────────────────────

def player_payload(db: Session, user: models.User) -> dict:
    inv = get_inventory(db, user)
    return {
        "schema_version": 6,
        "coins": user.coins,
        "foods": {fid: inv.get(fid, 0) for fid in FOOD_IDS},
        "selected_food": user.selected_food,
        "keeper": {"level": user.keeper_level, "xp": user.keeper_xp},
        "generation": user.generation,
        "snail_slots": user.snail_slots,
        "sound_on": user.sound_on,
        "background": user.background,
        "streak": {"count": user.streak_count, "last_date": user.streak_last_date},
        "last_daily_reward": user.last_daily_reward,
        "missions": user.missions or {"date": None, "feed": 0, "pet": 0, "explore": 0, "bonus_given": False},
        "mission_completions": user.mission_completions,
        "explore": user.explore_state or {"date": None, "searches": 0},
        "unlocked_maps": user.unlocked_maps or [],
        "decorations": {"owned": user.decorations_owned or [], "slots": user.decoration_slots or [None, None, None]},
        "last_seen": _aware(user.last_seen_at).isoformat(),
        "server_mode": True,
        "migration_done": user.migration_done,
    }


def snail_payload(s: models.Snail) -> dict:
    return {
        "schema_version": 6, "id": s.id, "name": s.name, "stage": s.stage,
        "level": s.level, "exp": s.exp,
        "hunger": int(round(s.hunger)), "happiness": int(round(s.happiness)),
        "color": s.color, "personality": s.personality, "wild_variant": s.wild_variant,
        "pos": {"rx": s.pos_x, "ry": s.pos_y},
        "created_at": _aware(s.created_at).isoformat() if s.created_at else None,
    }


def state_payload(db: Session, user: models.User, events: list[dict]) -> dict:
    db.flush()  # autoflush=False — pending 객체(새 알/앨범/일지)를 조회에 반영
    return {
        "revision": int(utcnow().timestamp()),
        "serverTime": utcnow().isoformat(),
        "changes": {
            "player": player_payload(db, user),
            "snails": [snail_payload(s) for s in active_snails(db, user)],
        },
        "album": [
            {
                "name": a.name, "color": a.color, "personality": a.personality,
                "level": a.level, "generation": a.generation,
                "hatched_at": _aware(a.hatched_at).isoformat() if a.hatched_at else None,
                "graduated_at": _aware(a.graduated_at).isoformat(),
            }
            for a in db.execute(select(models.AlbumEntry).where(models.AlbumEntry.user_id == user.id)
                                .order_by(models.AlbumEntry.graduated_at)).scalars()
        ],
        "journal": [
            {"ts": _aware(j.ts).isoformat(), "type": j.type, "text": j.text}
            for j in db.execute(select(models.JournalEntry).where(models.JournalEntry.user_id == user.id)
                                .order_by(models.JournalEntry.ts).limit(100)).scalars()
        ],
        "events": events,
    }


def new_egg(db: Session, user: models.User) -> models.Snail:
    egg = models.Snail(user_id=user.id, stage="egg", hunger=0, happiness=100)
    db.add(egg)
    return egg


# ── 멱등 처리 ───────────────────────────────────────────

def find_action(db: Session, user: models.User, request_id: str) -> models.GameAction | None:
    if not request_id:
        return None
    return db.execute(select(models.GameAction).where(
        models.GameAction.user_id == user.id,
        models.GameAction.request_id == request_id,
    )).scalar_one_or_none()


def record_action(db: Session, user: models.User, action_type: str, request_id: str,
                  target_id: str | None, payload: dict, result: dict) -> None:
    db.add(models.GameAction(
        user_id=user.id, action_type=action_type, request_id=request_id or models._uuid(),
        target_id=target_id, payload=payload, result=result,
    ))
