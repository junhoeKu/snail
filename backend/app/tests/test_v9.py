"""9차 — 동시성/멱등 강화/revision/인벤토리 원장/낙관적 잠금/Rate Limit."""
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import models
from app.core.middleware import RateLimitMiddleware, _hits
from app.tests.test_api import client, database, guest, hatch_first, rid


def _count(model, **filters) -> int:
    with database.SessionLocal() as db:
        q = select(func.count()).select_from(model)
        for k, v in filters.items():
            q = q.where(getattr(model, k) == v)
        return db.execute(q).scalar_one()


# ── 멱등 충돌 (같은 request_id·다른 payload) ─────────────

def test_idempotency_conflict_rejected(guest):
    egg_id, _ = hatch_first(guest)
    request_id = rid()
    before = _count(models.SecurityEvent, kind="idempotency_conflict")

    r1 = client.post(f"/v1/snails/{egg_id}/feed",
                     json={"requestId": request_id, "foodId": "lettuce"}, headers=guest["headers"])
    assert r1.status_code == 200
    # 같은 번호인데 내용(foodId) 다름 → 거부
    r2 = client.post(f"/v1/snails/{egg_id}/feed",
                     json={"requestId": request_id, "foodId": "carrot"}, headers=guest["headers"])
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "idempotency_conflict"
    assert _count(models.SecurityEvent, kind="idempotency_conflict") == before + 1


# ── revision 단조 증가 ──────────────────────────────────

def test_revision_increments_per_action(guest):
    egg_id, hatch_res = hatch_first(guest)
    rev0 = hatch_res["revision"]
    r1 = client.post(f"/v1/snails/{egg_id}/pet", json={"requestId": rid()}, headers=guest["headers"]).json()
    r2 = client.post(f"/v1/snails/{egg_id}/pet", json={"requestId": rid()}, headers=guest["headers"]).json()
    assert r1["revision"] > rev0
    assert r2["revision"] > r1["revision"]


# ── 인벤토리 원장 ───────────────────────────────────────

def test_feed_writes_inventory_ledger(guest):
    egg_id, _ = hatch_first(guest)
    before = _count(models.InventoryLedger, reason="feed_consume")
    client.post(f"/v1/snails/{egg_id}/feed", json={"requestId": rid()}, headers=guest["headers"])
    assert _count(models.InventoryLedger, reason="feed_consume") == before + 1
    with database.SessionLocal() as db:
        row = db.execute(select(models.InventoryLedger)
                         .where(models.InventoryLedger.reason == "feed_consume")
                         .order_by(models.InventoryLedger.created_at.desc())).scalars().first()
    assert row.delta == -1 and row.item_id == "lettuce"


# ── 낙관적 잠금 (rename) ────────────────────────────────

def test_rename_optimistic_lock(guest):
    egg_id, _ = hatch_first(guest)
    state = client.get("/v1/game/state", headers=guest["headers"]).json()
    version = state["changes"]["snails"][0]["version"]

    # 잘못된 기대 버전 → 충돌
    bad = client.patch(f"/v1/snails/{egg_id}/name",
                       json={"name": "새이름", "expectedVersion": version + 99}, headers=guest["headers"])
    assert bad.status_code == 409 and bad.json()["error"]["code"] == "version_conflict"

    # 올바른 기대 버전 → 성공하고 version 증가
    ok = client.patch(f"/v1/snails/{egg_id}/name",
                      json={"name": "새이름", "expectedVersion": version}, headers=guest["headers"])
    assert ok.status_code == 200 and ok.json()["version"] == version + 1


# ── Rate Limit ──────────────────────────────────────────

def test_rate_limit_returns_429():
    mini = FastAPI()
    mini.add_middleware(RateLimitMiddleware, limit=2, auth_limit=2)

    @mini.post("/v1/ping")
    def ping():
        return {"ok": True}

    _hits.clear()
    c = TestClient(mini)
    assert c.post("/v1/ping").status_code == 200
    assert c.post("/v1/ping").status_code == 200
    r = c.post("/v1/ping")
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited"
    # GET은 제한 대상 아님
    _hits.clear()
