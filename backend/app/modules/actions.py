"""서버 권위형 행동 — 클라이언트는 행동만 요청하고 결과(수치)는 서버가 판정한다."""
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

router = APIRouter(prefix="/v1", tags=["actions"])

FAIL_CODES = {
    "not_hatched": (409, "아직 알이에요."),
    "graduated": (409, "여행을 떠난 달팽이는 행동할 수 없어요."),
    "no_food": (409, "선택한 먹이가 없어요."),
    "not_hungry": (409, "지금은 배고프지 않아요."),
    "name_required": (422, "이름을 입력해주세요."),
    "already_hatched": (409, "이미 부화했어요."),
    "invalid_food": (422, "알 수 없는 먹이예요."),
}


def _snail_of(db: Session, user: models.User, snail_id: str) -> models.Snail:
    snail = db.get(models.Snail, snail_id)
    if snail is None or snail.user_id != user.id:
        raise ApiError(404, "snail_not_found", "달팽이를 찾을 수 없습니다.")
    return snail


def _keeper(db: Session, user: models.User, action: str) -> list[dict]:
    u = service.user_dict(user)
    coins, events = rules.gain_keeper_xp(u, action)
    service.apply_user_dict(user, u)
    if coins:
        db.add(models.CurrencyLedger(user_id=user.id, currency="coins", amount=coins,
                                     balance_after=user.coins, reason="keeper_levelup"))
    return events


def _deco_unlocks(db: Session, user: models.User) -> list[dict]:
    events: list[dict] = []
    owned = list(user.decorations_owned or [])
    checks = [
        ("wildflower", user.mission_completions >= rules.CONFIG["DECO_MISSIONS_REQUIRED"]),
        ("mossrock", user.generation >= rules.CONFIG["DECO_GENERATION_REQUIRED"]),
    ]
    for deco_id, met in checks:
        if met and deco_id not in owned:
            owned.append(deco_id)
            events.append({"type": "deco_unlocked", "decoId": deco_id})
            service.add_journal(db, user, "deco", f"{rules.DECORATIONS[deco_id]['label']} 장식을 해금했어요.")
    user.decorations_owned = owned
    return events


def _missions(db: Session, user: models.User, kinds: list[str]) -> list[dict]:
    """미션 진행 + 보상 + 양육자 XP 연쇄 (클라이언트 파이프라인과 동일 순서)."""
    events: list[dict] = []
    for kind in kinds:
        u = service.user_dict(user)
        before = u["coins"]
        reward, mission_events = rules.record_mission(u, kind, service.today_key(user))
        events += mission_events
        for e in mission_events:
            if e["type"] == "mission_done":
                _, ke = rules.gain_keeper_xp(u, "mission")
                events += ke
            if e["type"] == "mission_all_done":
                _, ke = rules.gain_keeper_xp(u, "mission_all")
                events += ke
        delta = u["coins"] - before
        service.apply_user_dict(user, u)
        if delta:
            db.add(models.CurrencyLedger(user_id=user.id, currency="coins", amount=delta,
                                         balance_after=user.coins, reason="mission_reward"))
        if reward["food"]:
            service.add_item(db, user, "lettuce", reward["food"], "mission_reward")
        if any(e["type"] == "mission_all_done" for e in mission_events):
            service.add_journal(db, user, "mission", "오늘의 돌봄을 모두 완료했어요.")
            events += _deco_unlocks(db, user)
    return events


class ActionIn(BaseModel):
    requestId: str = ""


def _run(db: Session, user: models.User, action_type: str, request_id: str,
         target_id: str | None, payload: dict, fn) -> dict:
    """행 잠금 → 멱등(해시 검증) → 선정산 → 행동 → revision → 상태 응답 → 이력 → 커밋."""
    if user.suspended_at is not None:
        raise ApiError(403, "suspended", "이용이 정지된 계정입니다. 운영자에게 문의해주세요.")
    phash = service.payload_fingerprint(payload)

    # 같은 사용자 동시 요청 직렬화 (재화 복제/음수 방지). 멱등 조회도 이 잠금 안에서.
    service.lock_user(db, user)

    existing = service.find_action(db, user, request_id)
    if existing is not None:
        # 같은 request_id인데 내용이 다르면 조작 의심 → 반영 없이 거부 + 보안 로그
        if existing.payload_hash and existing.payload_hash != phash:
            service.record_security_event(db, user.id, "idempotency_conflict",
                                          {"request_id": request_id, "action": action_type})
            db.commit()
            raise ApiError(409, "idempotency_conflict",
                           "같은 요청 번호로 다른 내용이 접수되었습니다.")
        return existing.result

    events = service.settle(db, user)
    try:
        events += fn()
    except ValueError as e:  # domain rule 실패 코드
        code = str(e)
        status, message = FAIL_CODES.get(code, (409, "요청을 처리할 수 없습니다."))
        db.rollback()
        raise ApiError(status, code, message)

    service.bump_revision(user)
    result = service.state_payload(db, user, events)
    service.record_action(db, user, action_type, request_id, target_id, payload,
                          {"events": events}, payload_hash=phash)
    db.commit()
    return result


# ── 달팽이 행동 ─────────────────────────────────────────

class FeedIn(ActionIn):
    foodId: str | None = None


@router.post("/snails/{snail_id}/feed")
def feed(snail_id: str, body: FeedIn,
         user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    def fn():
        snail = _snail_of(db, user, snail_id)
        s = service.snail_dict(snail)
        foods = service.get_inventory(db, user)
        food_id = body.foodId or user.selected_food or "lettuce"
        d, events = rules.feed(s, food_id, foods, user.decoration_slots)
        service.apply_snail_dict(snail, s)
        service.add_item(db, user, food_id, -1, "feed_consume", snail.id)
        service.add_coins(db, user, rules.CONFIG["FEED_COINS"], "feed_reward", snail.id)
        for e in events:
            if e["type"] == "levelup":
                service.add_journal(db, user, "levelup", f"{snail.name}(이)가 Lv.{e['level']}이 되었어요!")
            if e["type"] == "stage_up":
                service.add_journal(db, user, "stage_up", f"{snail.name}(이)가 성장했어요!")
        events += _keeper(db, user, "feed")
        events += _missions(db, user, ["feed"])
        return events
    return _run(db, user, "feed", body.requestId, snail_id, body.model_dump(), fn)


@router.post("/snails/{snail_id}/pet")
def pet(snail_id: str, body: ActionIn,
        user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    def fn():
        snail = _snail_of(db, user, snail_id)
        s = service.snail_dict(snail)
        events = rules.pet(s, user.decoration_slots)
        service.apply_snail_dict(snail, s)
        events += _missions(db, user, ["pet"])
        return events
    return _run(db, user, "pet", body.requestId, snail_id, body.model_dump(), fn)


class HatchIn(ActionIn):
    name: str


@router.post("/snails/{snail_id}/hatch")
def hatch(snail_id: str, body: HatchIn,
          user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    def fn():
        snail = _snail_of(db, user, snail_id)
        before = service.discovered_variants(db, user)
        s = service.snail_dict(snail)
        events = rules.hatch(s, body.name, user.generation)
        service.apply_snail_dict(snail, s)
        snail.hatched_at = service.utcnow()

        gen_label = f" ({user.generation}세대)" if user.generation > 1 else ""
        service.add_journal(db, user, "hatch", f"{snail.name}{gen_label}(이)가 알을 깨고 태어났어요!")
        if snail.color != "brown":
            label = rules.VARIANTS[snail.color]["label"]
            service.add_journal(db, user, "variant", f"{snail.name}(이)는 {label} 껍질을 가졌어요!")
        events += _keeper(db, user, "hatch")
        if snail.color not in before:
            events.append({"type": "dex_new", "color": snail.color})
            events += _keeper(db, user, "dex_new")
        return events
    return _run(db, user, "hatch", body.requestId, snail_id, body.model_dump(), fn)


@router.post("/snails/{snail_id}/graduate")
def graduate(snail_id: str, body: ActionIn,
             user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    def fn():
        snail = _snail_of(db, user, snail_id)
        s = service.snail_dict(snail)
        if not rules.can_graduate(s):
            raise ApiError(409, "cannot_graduate", "성체 Lv.12부터 여행을 보낼 수 있어요.")

        db.add(models.AlbumEntry(
            user_id=user.id, name=snail.name, color=snail.color,
            personality=snail.personality, level=snail.level,
            generation=user.generation, hatched_at=snail.hatched_at,
        ))
        snail.graduated_at = service.utcnow()
        service.add_coins(db, user, rules.CONFIG["GRADUATE_COINS"], "graduate", snail.id)
        service.add_journal(db, user, "graduate",
                            f"{snail.name}({user.generation}세대)가 넓은 세상으로 여행을 떠났어요.")
        user.generation += 1
        service.new_egg(db, user)  # 그 자리의 새 알
        events = [{"type": "graduated", "snailId": snail.id, "name": snail.name}]
        events += _keeper(db, user, "graduate")
        events += _deco_unlocks(db, user)
        return events
    return _run(db, user, "graduate", body.requestId, snail_id, body.model_dump(), fn)


class NameIn(BaseModel):
    name: str
    expectedVersion: int | None = None  # 있으면 낙관적 잠금 검증 (없으면 하위호환 스킵)


@router.patch("/snails/{snail_id}/name")
def rename(snail_id: str, body: NameIn,
           user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    snail = _snail_of(db, user, snail_id)
    name = body.name.strip()[:12]
    if not name:
        raise ApiError(422, "name_required", "이름을 입력해주세요.")
    if body.expectedVersion is not None and snail.version != body.expectedVersion:
        raise ApiError(409, "version_conflict", "다른 기기에서 먼저 변경되었어요. 최신 상태로 새로고침합니다.")
    snail.name = name
    snail.version += 1
    service.bump_revision(user)
    db.commit()
    return {"ok": True, "name": name, "version": snail.version}


# ── 상점 ────────────────────────────────────────────────

class PurchaseIn(ActionIn):
    kind: str            # food | egg_slot | decoration | map
    itemId: str | None = None
    count: int = 1


@router.post("/shop/purchase")
def purchase(body: PurchaseIn,
             user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    def fn():
        events: list[dict] = []
        if body.kind == "food":
            if body.count not in (1, rules.CONFIG["FOOD_BUNDLE_COUNT"]):
                raise ApiError(422, "invalid_count", "구매 수량이 올바르지 않습니다.")
            if not rules.food_unlocked(user.keeper_level, body.itemId or ""):
                raise ApiError(409, "food_locked", "아직 잠긴 먹이예요.")
            price = rules.food_price(body.itemId, body.count)
            service.add_coins(db, user, -price, "shop_food", None)
            service.add_item(db, user, body.itemId, body.count, "shop_food")
            events.append({"type": "food_bought", "foodId": body.itemId, "count": body.count})

        elif body.kind == "egg_slot":
            price = rules.egg_slot_price(user.snail_slots)
            if price is None or user.snail_slots >= settings.max_snails:
                raise ApiError(409, "max_slots", "보금자리가 가득해요.")
            if user.keeper_level < rules.egg_slot_level(user.snail_slots):
                raise ApiError(409, "slot_locked", "아직 잠긴 보금자리예요. 양육자 레벨을 올려보세요!")
            service.add_coins(db, user, -price, "shop_egg_slot", None)
            user.snail_slots += 1
            service.new_egg(db, user)
            service.add_journal(db, user, "egg", "새 보금자리에 알이 도착했어요!")
            events.append({"type": "egg_bought", "slots": user.snail_slots})

        elif body.kind == "decoration":
            deco = rules.DECORATIONS.get(body.itemId or "")
            if not deco or deco["type"] != "buy":
                raise ApiError(422, "invalid_item", "구매할 수 없는 장식입니다.")
            if body.itemId in (user.decorations_owned or []):
                raise ApiError(409, "already_owned", "이미 보유한 장식입니다.")
            service.add_coins(db, user, -deco["price"], "shop_decoration", None)
            user.decorations_owned = list(user.decorations_owned or []) + [body.itemId]
            events.append({"type": "deco_bought", "decoId": body.itemId})

        elif body.kind == "map":
            if rules.map_available(body.itemId or "", user.generation, user.unlocked_maps):
                raise ApiError(409, "already_owned", "이미 입장 가능한 맵입니다.")
            if body.itemId not in rules.EXPLORE_MAPS:
                raise ApiError(422, "invalid_item", "알 수 없는 맵입니다.")
            service.add_coins(db, user, -rules.CONFIG["EXPLORE_MAP_PRICE"], "shop_map", None)
            user.unlocked_maps = list(user.unlocked_maps or []) + [body.itemId]
            events.append({"type": "map_unlocked", "mapId": body.itemId})
        else:
            raise ApiError(422, "invalid_kind", "알 수 없는 구매 종류입니다.")
        return events
    return _run(db, user, f"purchase_{body.kind}", body.requestId, body.itemId, body.model_dump(), fn)


class SlotsIn(BaseModel):
    slots: list


@router.post("/decorations/slots")
def set_decoration_slots(body: SlotsIn,
                         user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    slots = (body.slots + [None, None, None])[:3]
    owned = user.decorations_owned or []
    for deco_id in slots:
        if deco_id is not None and deco_id not in owned:
            raise ApiError(409, "not_owned", "보유하지 않은 장식입니다.")
    user.decoration_slots = slots
    db.commit()
    return {"ok": True, "slots": slots}


# ── 탐험 ────────────────────────────────────────────────

class ExploreIn(ActionIn):
    mapId: str


@router.post("/explorations/search")
def explore_search(body: ExploreIn,
                   user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    def fn():
        if not rules.map_available(body.mapId, user.generation, user.unlocked_maps):
            raise ApiError(409, "map_locked", "아직 잠긴 맵입니다.")
        tk = service.today_key(user)
        state = dict(user.explore_state or {})
        if state.get("date") != tk:
            state = {"date": tk, "searches": 0}
        if state["searches"] >= rules.explore_max_searches(user.keeper_level):
            raise ApiError(409, "no_stamina", "오늘은 더 뒤질 힘이 없어요.")
        state["searches"] += 1
        user.explore_state = state

        # 12차: 야생 알(egg) 결과 제거 — 코인/상추/꽝만
        result = rules.explore_roll(user.generation, body.mapId)
        events: list[dict] = [{"type": "explored", "result": result}]
        if result["type"] == "coins":
            service.add_coins(db, user, result["amount"], "explore_find")
        elif result["type"] == "food":
            service.add_item(db, user, "lettuce", result["amount"], "explore_find")

        events += _keeper(db, user, "explore")
        events += _missions(db, user, ["explore"])
        return events
    return _run(db, user, "explore", body.requestId, body.mapId, body.model_dump(), fn)
