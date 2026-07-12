"""10차 — 어드민 인증 / 원격 게임 설정(검증·활성화·병합·롤백) / 우편함 엽서."""
from app import models
from app.domain import rules
from app.modules import config_service, service
from app.tests.test_api import client, database, guest, hatch_first, rid, set_snail

ADMIN = {"X-Admin-Token": "test-admin-token"}


# ── 어드민 인증 ─────────────────────────────────────────

def test_admin_requires_token():
    assert client.get("/admin/config/versions").status_code == 401
    assert client.get("/admin/config/versions", headers={"X-Admin-Token": "wrong"}).status_code == 401
    assert client.get("/admin/config/versions", headers=ADMIN).status_code == 200


# ── 원격 설정: 검증 · 활성화 · 병합 · 롤백 ───────────────

def test_remote_config_activate_and_merge():
    # 잘못된 설정(변이 확률 깨짐)은 draft 생성부터 거부
    bad = client.post("/admin/config/versions",
                      json={"config": {"variants": {"brown": {"chance": 0.9}}}, "note": "bad"}, headers=ADMIN)
    assert bad.status_code == 422

    # 상추 가격 오버라이드 draft → 활성화 → 실제 판정 반영
    draft = client.post("/admin/config/versions",
                        json={"config": {"foods": {"lettuce": {"price": 3}}}, "note": "상추 할인"}, headers=ADMIN)
    assert draft.status_code == 200
    ver = draft.json()["version"]

    act = client.post(f"/admin/config/versions/{ver}/activate", json={"reason": "이벤트"}, headers=ADMIN)
    assert act.status_code == 200
    assert act.json()["effective"]["foods"]["lettuce"]["price"] == 3
    assert rules.FOOD_DEFS["lettuce"]["price"] == 3  # rules 전역에 반영

    # 감사 로그 기록
    audit = client.get("/admin/audit", headers=ADMIN).json()["logs"]
    assert any(l["action"] == "config_activate" and l["reason"] == "이벤트" for l in audit)

    # 롤백: 빈 오버라이드 버전 활성화 → 기본값(10) 복원
    base = client.post("/admin/config/versions", json={"config": {}, "note": "기본 복원"}, headers=ADMIN).json()
    client.post(f"/admin/config/versions/{base['version']}/activate", json={"reason": "롤백"}, headers=ADMIN)
    assert rules.FOOD_DEFS["lettuce"]["price"] == 10


# ── 우편함 엽서 ─────────────────────────────────────────

def test_mailbox_letter_and_claim(guest, monkeypatch):
    # 졸업 달팽이 1마리 만들기
    egg_id, _ = hatch_first(guest)
    set_snail(egg_id, stage="adult", level=20)
    client.post(f"/v1/snails/{egg_id}/graduate", json={"requestId": rid()}, headers=guest["headers"])

    # 엽서 판정을 확정 당첨으로 고정
    monkeypatch.setattr(rules, "roll_letter",
                        lambda name, rng=None: {"title": f"{name}의 엽서", "body": "여비 보태요", "coins": 10})
    # last_letter_date 리셋 후 state 조회 → 정산에서 엽서 발송
    with database.SessionLocal() as db:
        u = db.get(models.User, guest["userId"]); u.last_letter_date = None; db.commit()

    state = client.get("/v1/game/state", headers=guest["headers"]).json()
    assert state["mailbox_unread"] >= 1
    assert any(e["type"] == "mail_arrived" for e in state["events"])

    box = client.get("/v1/mailbox", headers=guest["headers"]).json()["messages"]
    letter = next(m for m in box if not m["claimed"])
    coins_before = state["changes"]["player"]["coins"]

    # 수령 → 코인 +10
    r = client.post(f"/v1/mailbox/{letter['id']}/claim", headers=guest["headers"]).json()
    assert r["coins"] == coins_before + 10
    # 멱등: 재수령해도 재지급 없음
    r2 = client.post(f"/v1/mailbox/{letter['id']}/claim", headers=guest["headers"]).json()
    assert r2.get("already") is True and r2["coins"] == coins_before + 10
