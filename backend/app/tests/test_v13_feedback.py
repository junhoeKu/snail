"""13차(피드백 개선) — 서식지 드롭 먹이 지속 (Phase 2) + 모습 바꾸기 (Phase 3)."""
from datetime import timedelta

from app.domain import rules
from app.modules import service
from app.tests.test_api import client, guest, hatch_first, rid, set_snail  # noqa: F401


def _drop(guest, drop_id, food_id="lettuce", rx=0.3, ry=0.7):
    return client.post("/v1/habitat/foods",
                       json={"id": drop_id, "foodId": food_id, "rx": rx, "ry": ry},
                       headers=guest["headers"])


def _state(guest):
    return client.get("/v1/game/state", headers=guest["headers"]).json()


def test_drop_food_persists_in_state(guest):
    hatch_first(guest)
    r = _drop(guest, "d1")
    assert r.status_code == 200

    drops = _state(guest)["changes"]["player"]["dropped_foods"]
    assert len(drops) == 1
    assert drops[0]["id"] == "d1"
    assert drops[0]["food_id"] == "lettuce"
    assert drops[0]["rx"] == 0.3 and drops[0]["ry"] == 0.7


def test_drop_food_idempotent_same_id(guest):
    hatch_first(guest)
    assert _drop(guest, "d1").status_code == 200
    assert _drop(guest, "d1").status_code == 200  # 재전송 — 중복 기록 없음
    assert len(_state(guest)["changes"]["player"]["dropped_foods"]) == 1


def test_drop_food_validates_inventory(guest):
    """시작 상추 3개 — 대기 드롭 포함 재고를 넘길 수 없다 (소모는 없으므로 원장 무변동)."""
    hatch_first(guest)
    for i in range(3):
        assert _drop(guest, f"d{i}").status_code == 200
    r = _drop(guest, "d3")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "no_food"
    # 드롭은 소모가 아니다 — 재고 그대로 3
    assert _state(guest)["changes"]["player"]["foods"]["lettuce"] == 3


def test_drop_food_field_limit(guest):
    snail_id, _ = hatch_first(guest)
    # 상한 검증을 위해 재고를 넉넉히
    from app import models
    from app.core import database
    with database.SessionLocal() as db:
        user = db.get(models.User, db.get(models.Snail, snail_id).user_id)
        service.add_item(db, user, "lettuce", 20, "test_seed")
        db.commit()
    for i in range(rules.CONFIG["FIELD_FOOD_MAX"]):
        assert _drop(guest, f"m{i}").status_code == 200
    r = _drop(guest, "overflow")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "field_full"


def test_drop_food_rejects_unknown_food(guest):
    hatch_first(guest)
    r = _drop(guest, "dx", food_id="pizza")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_food"


def test_feed_with_drop_id_clears_drop(guest):
    snail_id, _ = hatch_first(guest)
    assert _drop(guest, "d1").status_code == 200
    r = client.post(f"/v1/snails/{snail_id}/feed",
                    json={"foodId": "lettuce", "dropId": "d1", "requestId": rid()},
                    headers=guest["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["changes"]["player"]["dropped_foods"] == []
    # 소모·보상은 기존 feed 경로 그대로 (상추 -1)
    assert r.json()["changes"]["player"]["foods"]["lettuce"] == 2


def test_prune_dropped_foods_ttl():
    now = service.utcnow()
    fresh = {"id": "a", "food_id": "lettuce", "dropped_at": now.isoformat()}
    stale = {"id": "b", "food_id": "lettuce",
             "dropped_at": (now - timedelta(hours=rules.CONFIG["FIELD_FOOD_TTL_HOURS"] + 1)).isoformat()}
    broken = {"id": "c", "food_id": "lettuce", "dropped_at": "not-a-date"}
    kept = rules.prune_dropped_foods([fresh, stale, broken], now)
    assert [d["id"] for d in kept] == ["a"]


def test_remove_drop_idempotent_and_revision(guest):
    """드롭/정리는 revision을 올려 다른 기기의 리싱크가 감지한다. 없는 id 삭제는 조용히 성공."""
    hatch_first(guest)
    rev0 = _state(guest)["revision"]
    assert _drop(guest, "d1").status_code == 200
    assert _state(guest)["revision"] > rev0

    r = client.delete("/v1/habitat/foods/d1", headers=guest["headers"])
    assert r.status_code == 200
    assert _state(guest)["changes"]["player"]["dropped_foods"] == []
    assert client.delete("/v1/habitat/foods/d1", headers=guest["headers"]).status_code == 200


# ── Phase 4/정리: 장식 제거 호환 · 배경 검증 ──

def test_decoration_legacy_endpoint_tolerant(guest):
    """장식 시스템 제거 후에도 구버전 클라의 슬롯 저장은 조용히 성공한다 (효과 없음)."""
    hatch_first(guest)
    r = client.post("/v1/decorations/slots", json={"slots": ["mossrock", None, None]},
                    headers=guest["headers"])
    assert r.status_code == 200
    # 응답 형태 호환: decorations 필드는 유지되고 효과는 어디에도 적용되지 않는다
    assert "decorations" in _state(guest)["changes"]["player"]


def test_decoration_purchase_rejected(guest):
    """장식 구매는 종료 — 구버전 클라 시도는 코인 차감 없이 거절."""
    hatch_first(guest)
    coins0 = _state(guest)["changes"]["player"]["coins"]
    r = client.post("/v1/shop/purchase",
                    json={"kind": "decoration", "itemId": "pebble", "requestId": rid()},
                    headers=guest["headers"])
    assert r.status_code == 422
    assert _state(guest)["changes"]["player"]["coins"] == coins0


def test_background_validation_garden_retired(guest):
    hatch_first(guest)
    for bg, accepted in [("pond", True), ("fern", True), ("garden", False), ("mars", False)]:
        r = client.patch("/v1/game/settings", json={"background": bg}, headers=guest["headers"])
        assert r.status_code == 200
        now = _state(guest)["changes"]["player"]["background"]
        if accepted:
            assert now == bg
        else:
            assert now != bg  # 무효 배경은 조용히 무시


# ── 모습 바꾸기 (skin_stage — 연출 전용, 도달한 단계만) ──

def test_skin_gate_and_change(guest):
    snail_id, _ = hatch_first(guest)
    # 아기(Lv1)는 junior 모습을 고를 수 없다
    r = client.patch(f"/v1/snails/{snail_id}/skin", json={"stage": "junior"},
                     headers=guest["headers"])
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "skin_locked"

    # 성체가 되면 아기 모습으로 회귀 가능 — 판정용 stage는 그대로 adult
    set_snail(snail_id, level=20, stage="adult")
    r = client.patch(f"/v1/snails/{snail_id}/skin", json={"stage": "baby"},
                     headers=guest["headers"])
    assert r.status_code == 200 and r.json()["skin_stage"] == "baby"
    snail = _state(guest)["changes"]["snails"][0]
    assert snail["skin_stage"] == "baby" and snail["stage"] == "adult"

    # 실제 단계와 같은 모습을 고르면 저장하지 않는다 (None)
    r = client.patch(f"/v1/snails/{snail_id}/skin", json={"stage": "adult"},
                     headers=guest["headers"])
    assert r.status_code == 200 and r.json()["skin_stage"] is None


def test_stage_up_resets_skin():
    s = {"id": "x", "stage": "baby", "level": 9, "exp": 44, "skin_stage": "baby"}
    events = rules.gain_exp(s, 1)  # Lv10 도달 → junior 진화
    assert any(e["type"] == "stage_up" for e in events)
    assert s["skin_stage"] is None


def test_settle_prunes_stale_drops(guest):
    snail_id, _ = hatch_first(guest)
    assert _drop(guest, "old").status_code == 200
    # 드롭 시각을 TTL 이전으로 되돌린다
    from app import models
    from app.core import database
    with database.SessionLocal() as db:
        user = db.get(models.User, db.get(models.Snail, snail_id).user_id)
        drops = [dict(d) for d in user.dropped_foods]  # 스냅샷 공유 방지 (JSON 변경 감지)
        drops[0]["dropped_at"] = (
            service.utcnow() - timedelta(hours=rules.CONFIG["FIELD_FOOD_TTL_HOURS"] + 1)
        ).isoformat()
        user.dropped_foods = drops
        db.commit()
    assert _state(guest)["changes"]["player"]["dropped_foods"] == []
