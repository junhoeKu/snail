"""LocalStorage v6 → 서버 1회 마이그레이션 (검증·정규화·단일 트랜잭션)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..core.config import settings
from ..core.database import get_db
from ..core.deps import get_current_user
from ..core.errors import ApiError
from ..domain import rules
from . import service

router = APIRouter(prefix="/v1/migrations", tags=["migration"])

ALLOWED_STAGES = {"egg", "baby", "junior", "adult"}
ALLOWED_COLORS = set(rules.VARIANTS.keys())
ALLOWED_PERSONALITIES = set(rules.PERSONALITIES.keys()) | {None}


class MigrationIn(BaseModel):
    schemaVersion: int
    player: dict
    snails: list[dict]
    album: list[dict] = []
    journal: list[dict] = []


def _clamp_int(value, lo: int, hi: int, default: int = 0) -> int:
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return default


def _parse_ts(value) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


@router.post("/local-v6")
def migrate_local_v6(body: MigrationIn,
                     user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.schemaVersion != 6:
        raise ApiError(422, "unsupported_schema", "지원하지 않는 스키마 버전입니다.")
    if user.migration_done:
        raise ApiError(409, "already_migrated", "이미 이전이 완료된 계정입니다.")

    active_hatched = [s for s in service.active_snails(db, user) if s.stage != "egg"]
    if active_hatched or user.coins != 30 or (user.keeper_level, user.keeper_xp) != (1, 0):
        raise ApiError(409, "server_not_empty", "서버에 이미 진행 데이터가 있습니다.")

    p = body.player or {}
    if len(body.snails) > settings.max_snails:
        raise ApiError(422, "too_many_snails", f"달팽이는 최대 {settings.max_snails}마리까지 이전할 수 있습니다.")

    # ── 사용자 필드 (관리자 모드 흔적은 상한 클램프 + 격리 로그) ──
    coins = _clamp_int(p.get("coins", 0), 0, settings.migration_coin_cap)
    if coins != p.get("coins", 0):
        db.add(models.GameAction(user_id=user.id, action_type="migration_clamp",
                                 request_id=f"clamp-{user.id}", payload={"coins": p.get("coins")}, result={}))
    user.coins = coins
    keeper = p.get("keeper") or {}
    user.keeper_level = _clamp_int(keeper.get("level", 1), 1, 50, 1)
    user.keeper_xp = _clamp_int(keeper.get("xp", 0), 0, 10000)
    user.generation = _clamp_int(p.get("generation", 1), 1, 100, 1)
    user.snail_slots = _clamp_int(p.get("snail_slots", 1), 1, settings.max_snails, 1)
    user.sound_on = bool(p.get("sound_on", True))
    user.selected_food = p.get("selected_food") if p.get("selected_food") in rules.FOOD_DEFS else "lettuce"
    user.background = p.get("background") if p.get("background") in ("default", "garden") else "default"

    streak = p.get("streak") or {}
    user.streak_count = _clamp_int(streak.get("count", 0), 0, 10000)
    user.streak_last_date = streak.get("last_date")
    user.last_daily_reward = p.get("last_daily_reward")
    user.missions = p.get("missions") or {}
    user.mission_completions = _clamp_int(p.get("mission_completions", 0), 0, 100000)
    user.explore_state = p.get("explore") or {}
    user.unlocked_maps = [m for m in (p.get("unlocked_maps") or []) if m in rules.EXPLORE_MAPS]

    deco = p.get("decorations") or {}
    user.decorations_owned = [d for d in (deco.get("owned") or []) if d in rules.DECORATIONS]
    slots = [(s if s in user.decorations_owned else None) for s in (deco.get("slots") or [])]
    user.decoration_slots = (slots + [None, None, None])[:3]

    # ── 먹이 인벤토리 ──
    foods = p.get("foods") or {}
    for food_id in rules.FOOD_DEFS:
        service.set_item(db, user, food_id, _clamp_int(foods.get(food_id, 0), 0, 9999))

    # ── 달팽이 (게스트 생성 시 받은 기본 알은 제거 후 교체) ──
    for snail in service.active_snails(db, user):
        db.delete(snail)
    now = service.utcnow()
    for raw in body.snails:
        stage = raw.get("stage") if raw.get("stage") in ALLOWED_STAGES else "egg"
        color = raw.get("color") if raw.get("color") in ALLOWED_COLORS else "brown"
        personality = raw.get("personality") if raw.get("personality") in ALLOWED_PERSONALITIES else None
        pos = raw.get("pos") or {}
        db.add(models.Snail(
            user_id=user.id, name=str(raw.get("name", ""))[:12], stage=stage,
            level=_clamp_int(raw.get("level", 0), 0, 999),
            exp=_clamp_int(raw.get("exp", 0), 0, 100000),
            hunger=_clamp_int(raw.get("hunger", 0), 0, 100),
            happiness=_clamp_int(raw.get("happiness", 100), 0, 100),
            color=color, personality=personality,
            wild_variant=raw.get("wild_variant") if raw.get("wild_variant") in ALLOWED_COLORS else None,
            pos_x=min(1.0, max(0.0, float(pos.get("rx", 0.5) or 0.5))),
            pos_y=min(1.0, max(0.0, float(pos.get("ry", 0.5) or 0.5))),
            hatched_at=_parse_ts(raw.get("created_at")) if stage != "egg" else None,
            last_state_at=now,
        ))

    # ── 앨범/일지 ──
    for raw in body.album[:200]:
        if raw.get("color") not in ALLOWED_COLORS:
            continue
        db.add(models.AlbumEntry(
            user_id=user.id, name=str(raw.get("name", ""))[:12], color=raw["color"],
            personality=raw.get("personality") if raw.get("personality") in ALLOWED_PERSONALITIES else None,
            level=_clamp_int(raw.get("level", 1), 1, 999),
            generation=_clamp_int(raw.get("generation", 1), 1, 100, 1),
            hatched_at=_parse_ts(raw.get("hatched_at")),
            graduated_at=_parse_ts(raw.get("graduated_at")) or now,
        ))
    for raw in body.journal[-100:]:
        db.add(models.JournalEntry(
            user_id=user.id, ts=_parse_ts(raw.get("ts")) or now,
            type=str(raw.get("type", "note"))[:24], text=str(raw.get("text", ""))[:500],
        ))

    user.migration_done = True
    user.last_seen_at = now
    service.record_action(db, user, "migration_local_v6", f"migration-{user.id}", None,
                          {"schemaVersion": 6, "snails": len(body.snails)}, {"ok": True})
    db.commit()
    return service.state_payload(db, user, [{"type": "migrated"}])
