"""통합 테스트 — 인증/마이그레이션/서버 판정/불변식.

수치는 클라이언트 jsdom 테스트와 교차 대조된 값을 사용한다.
"""
import os
import uuid

os.environ["DATABASE_URL"] = "sqlite://"  # 인메모리
os.environ["JWT_SECRET"] = "test-secret"
os.environ.setdefault("RATE_LIMIT_PER_MIN", "100000")       # 기능 테스트는 무제한
os.environ.setdefault("RATE_LIMIT_AUTH_PER_MIN", "100000")
os.environ.setdefault("ADMIN_TOKEN", "test-admin-token")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.pool import StaticPool

from app.core import database
from app.core.database import Base

# 인메모리 SQLite를 스레드 간 공유
database.engine.dispose()
from sqlalchemy import create_engine  # noqa: E402
database.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
database.SessionLocal.configure(bind=database.engine)

from app import models  # noqa: E402
from app.domain import rules  # noqa: E402
from app.main import create_app, seed_items  # noqa: E402
from app.modules import service  # noqa: E402

Base.metadata.create_all(database.engine)  # TestClient는 lifespan 밖이라 직접 초기화
app = create_app()
seed_items()
client = TestClient(app)


def rid() -> str:
    return uuid.uuid4().hex


@pytest.fixture()
def guest():
    r = client.post("/v1/auth/guest")
    assert r.status_code == 200
    tokens = r.json()
    return {"headers": {"Authorization": f"Bearer {tokens['accessToken']}"}, **tokens}


def hatch_first(guest, name="달달이"):
    state = client.get("/v1/game/state", headers=guest["headers"]).json()
    egg_id = state["changes"]["snails"][0]["id"]
    r = client.post(f"/v1/snails/{egg_id}/hatch", json={"name": name, "requestId": rid()}, headers=guest["headers"])
    assert r.status_code == 200, r.text
    return egg_id, r.json()


def set_user(user_id, **kwargs):
    with database.SessionLocal() as db:
        user = db.get(models.User, user_id)
        for k, v in kwargs.items():
            setattr(user, k, v)
        db.commit()


def set_snail(snail_id, **kwargs):
    with database.SessionLocal() as db:
        snail = db.get(models.Snail, snail_id)
        for k, v in kwargs.items():
            setattr(snail, k, v)
        db.commit()


# ── 인증 ────────────────────────────────────────────────

def test_guest_and_refresh_rotation(guest):
    state = client.get("/v1/game/state", headers=guest["headers"])
    assert state.status_code == 200
    # 접속 보상 자동 정산: 30 + 20 = 50
    assert state.json()["changes"]["player"]["coins"] == 50

    r = client.post("/v1/auth/refresh", json={"refreshToken": guest["refreshToken"]})
    assert r.status_code == 200
    # 회전: 이전 refresh는 폐기
    r2 = client.post("/v1/auth/refresh", json={"refreshToken": guest["refreshToken"]})
    assert r2.status_code == 401


def test_unauthorized():
    assert client.get("/v1/game/state").status_code == 401


# ── 부화/급식 (서버 판정 + 트랜잭션 + 원장) ─────────────

def test_hatch_feed_flow(guest):
    egg_id, result = hatch_first(guest)
    events = [e["type"] for e in result["events"]]
    assert "hatched" in events and "dex_new" in events

    snail = result["changes"]["snails"][0]
    assert snail["stage"] == "baby" and snail["hunger"] == 40

    # 급식: 서버가 경험치/코인 판정 (클라이언트는 요청만)
    r = client.post(f"/v1/snails/{egg_id}/feed", json={"requestId": rid()}, headers=guest["headers"]).json()
    snail = r["changes"]["snails"][0]
    player = r["changes"]["player"]
    # 상추 exp 22 → Lv1(need5)+Lv2(need10) 소진 → Lv3, exp 7. hunger 40-30=10
    assert snail["hunger"] == 10 and snail["level"] == 3 and snail["exp"] == 7
    assert player["foods"]["lettuce"] == 2
    assert any(e["type"] == "fed" for e in r["events"])

    # 원장 기록 확인
    with database.SessionLocal() as db:
        ledger = db.execute(select(models.CurrencyLedger).where(
            models.CurrencyLedger.user_id == guest["userId"],
            models.CurrencyLedger.reason == "feed_reward")).scalars().all()
        assert len(ledger) == 1 and ledger[0].amount == rules.CONFIG["FEED_COINS"]


def test_feed_validations(guest):
    egg_id, _ = hatch_first(guest)
    client.post(f"/v1/snails/{egg_id}/feed", json={"requestId": rid()}, headers=guest["headers"])
    client.post(f"/v1/snails/{egg_id}/feed", json={"requestId": rid()}, headers=guest["headers"])
    # hunger 0 → not_hungry
    r = client.post(f"/v1/snails/{egg_id}/feed", json={"requestId": rid()}, headers=guest["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_hungry"


def test_idempotency(guest):
    egg_id, _ = hatch_first(guest)
    request_id = rid()
    r1 = client.post(f"/v1/snails/{egg_id}/feed", json={"requestId": request_id}, headers=guest["headers"]).json()
    r2 = client.post(f"/v1/snails/{egg_id}/feed", json={"requestId": request_id}, headers=guest["headers"]).json()
    # 같은 request_id는 재실행되지 않고 저장된 결과 반환
    assert r2["events"] == [e for e in r1["events"]]
    state = client.get("/v1/game/state", headers=guest["headers"]).json()
    assert state["changes"]["player"]["foods"]["lettuce"] == 2  # 1개만 소모


# ── 구매/불변식 ─────────────────────────────────────────

def test_purchase_and_coin_invariant(guest):
    hatch_first(guest)
    # 코인 부족 시 409 + 잔액 불변 (음수 금지)
    r = client.post("/v1/shop/purchase",
                    json={"kind": "egg_slot", "requestId": rid()}, headers=guest["headers"])
    assert r.status_code == 409
    state = client.get("/v1/game/state", headers=guest["headers"]).json()
    assert state["changes"]["player"]["coins"] >= 0

    set_user(guest["userId"], coins=5000, keeper_level=2)  # 슬롯2는 양육자 Lv2부터
    r = client.post("/v1/shop/purchase",
                    json={"kind": "food", "itemId": "lettuce", "count": 10, "requestId": rid()},
                    headers=guest["headers"]).json()
    assert r["changes"]["player"]["coins"] == 5000 - 90  # 묶음 10% 할인
    r = client.post("/v1/shop/purchase",
                    json={"kind": "food", "itemId": "salad", "count": 1, "requestId": rid()},
                    headers=guest["headers"])
    assert r.json()["error"]["code"] == "food_locked"  # 양육자 Lv6 필요

    r = client.post("/v1/shop/purchase", json={"kind": "egg_slot", "requestId": rid()}, headers=guest["headers"]).json()
    assert r["changes"]["player"]["snail_slots"] == 2
    assert sum(1 for s in r["changes"]["snails"] if s["stage"] == "egg") == 1


# ── 여행 (트랜잭션: 앨범 + 새 알 + 세대) ────────────────

def test_graduate_flow(guest):
    egg_id, _ = hatch_first(guest)
    r = client.post(f"/v1/snails/{egg_id}/graduate", json={"requestId": rid()}, headers=guest["headers"])
    assert r.json()["error"]["code"] == "cannot_graduate"

    set_snail(egg_id, stage="adult", level=20)
    r = client.post(f"/v1/snails/{egg_id}/graduate", json={"requestId": rid()}, headers=guest["headers"]).json()
    assert any(e["type"] == "graduated" for e in r["events"])
    assert r["changes"]["player"]["generation"] == 2
    assert len(r["album"]) == 1 and r["album"][0]["name"] == "달달이"
    # 새 알이 그 자리에
    assert any(s["stage"] == "egg" for s in r["changes"]["snails"])
    # 졸업한 달팽이는 목록에서 제외 + 행동 불가
    assert all(s["id"] != egg_id or s["stage"] == "egg" for s in r["changes"]["snails"])
    r2 = client.post(f"/v1/snails/{egg_id}/feed", json={"requestId": rid()}, headers=guest["headers"])
    assert r2.status_code == 409 and r2.json()["error"]["code"] == "graduated"


# ── 탐험 (스태미나/서버 판정) ───────────────────────────

def test_explore_stamina_and_lock(guest):
    hatch_first(guest)
    r = client.post("/v1/explorations/search", json={"mapId": "pond", "requestId": rid()}, headers=guest["headers"])
    assert r.json()["error"]["code"] == "map_locked"

    for _ in range(10):
        r = client.post("/v1/explorations/search", json={"mapId": "moss", "requestId": rid()}, headers=guest["headers"])
        assert r.status_code == 200
    r = client.post("/v1/explorations/search", json={"mapId": "moss", "requestId": rid()}, headers=guest["headers"])
    assert r.json()["error"]["code"] == "no_stamina"

    # 양육자 Lv5 → 스태미나 12
    set_user(guest["userId"], keeper_level=5)
    r = client.post("/v1/explorations/search", json={"mapId": "moss", "requestId": rid()}, headers=guest["headers"])
    assert r.status_code == 200


# ── 서버 시간 권위 (클라이언트 시각 조작 무효) ──────────

def test_server_time_authority(guest):
    egg_id, _ = hatch_first(guest)
    # 클라이언트가 미래 시각을 보낼 방법 자체가 없음 — 감쇠는 last_state_at 기준
    import datetime
    set_snail(egg_id, last_state_at=service.utcnow() - datetime.timedelta(hours=5))
    state = client.get("/v1/game/state", headers=guest["headers"]).json()
    snail = state["changes"]["snails"][0]
    assert snail["hunger"] == 40 + 35  # 5시간 × 7

    # 일일 보상은 사용자 타임존의 서버 날짜 기준 — 같은 날 중복 없음
    coins = state["changes"]["player"]["coins"]
    state2 = client.get("/v1/game/state", headers=guest["headers"]).json()
    assert state2["changes"]["player"]["coins"] == coins


# ── 마이그레이션 ────────────────────────────────────────

V6_PAYLOAD = {
    "schemaVersion": 6,
    "player": {
        "coins": 4321, "foods": {"lettuce": 7, "carrot": 2}, "selected_food": "carrot",
        "keeper": {"level": 3, "xp": 10}, "generation": 2, "snail_slots": 2,
        "sound_on": True, "background": "garden",
        "streak": {"count": 4, "last_date": "2026-07-11"}, "last_daily_reward": "2026-07-11",
        "missions": {"date": "2026-07-11", "feed": 2, "pet": 1, "explore": 1, "bonus_given": True},
        "mission_completions": 3, "explore": {"date": "2026-07-11", "searches": 4},
        "unlocked_maps": ["pond"], "decorations": {"owned": ["pebble"], "slots": ["pebble", None, None]},
    },
    "snails": [
        {"name": "몽이", "stage": "junior", "level": 6, "exp": 5, "hunger": 30, "happiness": 70,
         "color": "olive", "personality": "sleepy", "pos": {"rx": 0.3, "ry": 0.6},
         "created_at": "2026-07-10T00:00:00Z"},
        {"stage": "egg", "name": "", "level": 0, "exp": 0, "hunger": 0, "happiness": 100, "color": "brown"},
    ],
    "album": [{"name": "달달이", "color": "brown", "personality": "foodie", "level": 12,
               "generation": 1, "hatched_at": "2026-07-01T00:00:00Z", "graduated_at": "2026-07-09T00:00:00Z"}],
    "journal": [{"ts": "2026-07-10T00:00:00Z", "type": "hatch", "text": "몽이가 태어났어요!"}],
}


def test_migration_roundtrip_and_once(guest):
    r = client.post("/v1/migrations/local-v6", json=V6_PAYLOAD, headers=guest["headers"]).json()
    player = r["changes"]["player"]
    assert player["coins"] == 4321 and player["foods"]["carrot"] == 2
    assert player["keeper"]["level"] == 3 and player["generation"] == 2
    assert player["decorations"]["slots"] == []  # 장식 시스템 제거 — 이전하지 않는다
    names = [s["name"] for s in r["changes"]["snails"]]
    assert "몽이" in names and len(r["changes"]["snails"]) == 2
    assert len(r["album"]) == 1 and len(r["journal"]) == 1

    # 1회만 성공
    r2 = client.post("/v1/migrations/local-v6", json=V6_PAYLOAD, headers=guest["headers"])
    assert r2.status_code == 409 and r2.json()["error"]["code"] == "already_migrated"


def test_migration_validation(guest):
    bad = {**V6_PAYLOAD, "player": {**V6_PAYLOAD["player"], "coins": 99999999},
           "snails": V6_PAYLOAD["snails"] + [{"stage": "baby"}] * 9}  # 2+9=11 > MAX 8
    r = client.post("/v1/migrations/local-v6", json=bad, headers=guest["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_many_snails"

    bad2 = {**V6_PAYLOAD, "snails": [{"stage": "dragon", "color": "rainbow", "level": -5}],
            "player": {**V6_PAYLOAD["player"], "coins": 99999999}}
    r = client.post("/v1/migrations/local-v6", json=bad2, headers=guest["headers"]).json()
    player = r["changes"]["player"]
    assert player["coins"] == 100000  # 관리자 흔적 클램프
    snail = r["changes"]["snails"][0]
    assert snail["stage"] == "egg" and snail["color"] == "brown" and snail["level"] == 0  # 화이트리스트


def test_migration_requires_empty_server(guest):
    hatch_first(guest)
    r = client.post("/v1/migrations/local-v6", json=V6_PAYLOAD, headers=guest["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "server_not_empty"


# ── 미션/양육자 연쇄 (클라이언트 경제와 교차 대조) ──────

def test_mission_keeper_cascade(guest):
    egg_id, _ = hatch_first(guest)
    client.post(f"/v1/snails/{egg_id}/feed", json={"requestId": rid()}, headers=guest["headers"])
    r = client.post(f"/v1/snails/{egg_id}/feed", json={"requestId": rid()}, headers=guest["headers"]).json()
    types = [e["type"] for e in r["events"]]
    assert "mission_done" in types
    # 클라이언트 v7 테스트와 동일: 부화(15+25)+daily(5)=45 → 먹이2(2+2)+미션(5)=54 → Lv2
    assert "keeper_levelup" in types
    assert r["changes"]["player"]["coins"] == 124  # 50+2+2+10+60
