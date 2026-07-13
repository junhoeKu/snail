"""13차 — 히든 변이 시간 조건 + 도감 등급 완성 보상(우편함)."""
import uuid

from app import models
from app.domain import rules
from app.modules import service
from app.tests.test_api import client, database, guest


# ── 히든 변이 시간 조건 (천사=낮 06~18, 악마=밤 18~06) ──

def test_variant_time_gate_day():
    table = rules.variant_table_for(1, hour=12)  # 낮
    assert table["devil"] == 0        # 악마는 낮에 등장하지 않는다
    assert table["angel"] > 0         # 천사는 낮에 등장한다
    assert abs(table["bee"] - 0.005) < 1e-9  # 꿀벌은 시간 무관
    assert abs(sum(table.values()) - 1.0) < 1e-9  # 확률 합 보존


def test_variant_time_gate_night():
    table = rules.variant_table_for(1, hour=1)  # 밤
    assert table["angel"] == 0
    assert table["devil"] > 0
    assert abs(sum(table.values()) - 1.0) < 1e-9


def test_variant_no_gate_when_hour_none():
    table = rules.variant_table_for(1)  # 시간 미지정 → 게이트 없음
    assert table["angel"] > 0 and table["devil"] > 0


def test_roll_variant_blocked_goes_brown():
    # 낮에 악마 구간(누적 rng)을 노려도 악마 대신 갈색이 나온다
    assert rules.roll_variant(1, rng=lambda: 0.9999, hour=12) != "devil"


# ── 도감 등급 완성 판정 ──

def test_dex_completed_tiers():
    assert rules.dex_completed_tiers([]) == []
    # 레어 등급은 연못 1종뿐 → 발견 시 완성
    assert "rare" in rules.dex_completed_tiers(["pond"])
    # 에픽 3종 모두 있어야 완성
    assert "epic" not in rules.dex_completed_tiers(["bee"])
    assert "epic" in rules.dex_completed_tiers(["bee", "devil", "angel"])


# ── 도감 완성 보상: 우편함 생성 + 멱등 + 수령 ──

def _fresh_user(db) -> models.User:
    user = models.User(id=uuid.uuid4().hex)
    db.add(user)
    db.flush()
    return user


def test_dex_reward_mailbox_and_idempotent():
    with database.SessionLocal() as db:
        user = _fresh_user(db)
        db.add(models.AlbumEntry(user_id=user.id, name="졸업이", color="pond",
                                 level=20, generation=1))
        db.flush()

        events = service.grant_dex_rewards(db, user)
        assert any(e["type"] == "dex_tier_complete" and e["tier"] == "rare" for e in events)
        db.commit()

        mails = [m for m in db.query(models.MailboxMessage)
                 .filter_by(user_id=user.id, kind="dex_reward").all()]
        assert len(mails) == 1
        assert mails[0].rewards["coins"] == rules.CONFIG["DEX_TIER_REWARDS"]["rare"]

        # 재호출 시 중복 발급 없음 (멱등)
        assert service.grant_dex_rewards(db, user) == []
        db.commit()
        assert db.query(models.MailboxMessage).filter_by(
            user_id=user.id, kind="dex_reward").count() == 1


def test_dex_reward_claim_grants_coins():
    with database.SessionLocal() as db:
        user = _fresh_user(db)
        db.add(models.AlbumEntry(user_id=user.id, name="졸업이", color="pond",
                                 level=20, generation=1))
        db.flush()
        service.grant_dex_rewards(db, user)
        db.commit()
        mail = db.query(models.MailboxMessage).filter_by(
            user_id=user.id, kind="dex_reward").first()
        coins0 = user.coins
        service.add_coins(db, user, mail.rewards["coins"], "mail_dex_reward", mail.id)
        db.commit()
        assert user.coins == coins0 + rules.CONFIG["DEX_TIER_REWARDS"]["rare"]
