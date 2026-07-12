"""전체 스키마 — SQLite(개발)/PostgreSQL(운영) 호환 타입만 사용."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .core.database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    auth_type: Mapped[str] = mapped_column(String(16), default="guest")  # guest | social
    provider: Mapped[str | None] = mapped_column(String(16), nullable=True)
    provider_user_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    nickname: Mapped[str | None] = mapped_column(String(32), nullable=True)
    timezone: Mapped[str] = mapped_column(String(48), default="Asia/Seoul")

    keeper_level: Mapped[int] = mapped_column(Integer, default=1)
    keeper_xp: Mapped[int] = mapped_column(Integer, default=0)
    coins: Mapped[int] = mapped_column(Integer, default=30)
    generation: Mapped[int] = mapped_column(Integer, default=1)
    snail_slots: Mapped[int] = mapped_column(Integer, default=1)
    revision: Mapped[int] = mapped_column(Integer, default=0)  # 상태 변경 단조 카운터 (기기 간 동기화)
    sound_on: Mapped[bool] = mapped_column(Boolean, default=True)
    selected_food: Mapped[str] = mapped_column(String(16), default="lettuce")
    background: Mapped[str] = mapped_column(String(16), default="default")

    streak_count: Mapped[int] = mapped_column(Integer, default=0)
    streak_last_date: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD (user tz)
    last_daily_reward: Mapped[str | None] = mapped_column(String(10), nullable=True)
    last_letter_date: Mapped[str | None] = mapped_column(String(10), nullable=True)  # 졸업 엽서 daily 판정 가드

    # 미션/탐험/장식 상태 (실용적 절충: 조인 없이 JSON 컬럼 — 계획서 §4.4 분리안 대비 단순화)
    missions: Mapped[dict] = mapped_column(JSON, default=dict)          # {date, feed, pet, explore, bonus_given}
    mission_completions: Mapped[int] = mapped_column(Integer, default=0)
    explore_state: Mapped[dict] = mapped_column(JSON, default=dict)     # {date, searches}
    unlocked_maps: Mapped[list] = mapped_column(JSON, default=list)
    decorations_owned: Mapped[list] = mapped_column(JSON, default=list)
    decoration_slots: Mapped[list] = mapped_column(JSON, default=lambda: [None, None, None])

    migration_done: Mapped[bool] = mapped_column(Boolean, default=False)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # 운영자 정지
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Snail(Base):
    __tablename__ = "snails"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(24), default="")
    stage: Mapped[str] = mapped_column(String(12), default="egg")  # egg|baby|junior|adult
    level: Mapped[int] = mapped_column(Integer, default=0)
    exp: Mapped[int] = mapped_column(Integer, default=0)
    hunger: Mapped[float] = mapped_column(Float, default=0)
    happiness: Mapped[float] = mapped_column(Float, default=100)
    color: Mapped[str] = mapped_column(String(16), default="brown")
    personality: Mapped[str | None] = mapped_column(String(16), nullable=True)
    wild_variant: Mapped[str | None] = mapped_column(String(16), nullable=True)
    pos_x: Mapped[float] = mapped_column(Float, default=0.5)  # 0~1 비율 좌표
    pos_y: Mapped[float] = mapped_column(Float, default=0.5)
    hatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_state_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    version: Mapped[int] = mapped_column(Integer, default=1)  # 낙관적 잠금
    graduated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Item(Base):
    """먹이·장식·향후 재화 공용 카탈로그."""
    __tablename__ = "items"

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    item_type: Mapped[str] = mapped_column(String(16))  # food | decoration
    name: Mapped[str] = mapped_column(String(32))
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class Inventory(Base):
    __tablename__ = "inventories"
    __table_args__ = (UniqueConstraint("user_id", "item_id"),)

    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id"), primary_key=True)
    item_id: Mapped[str] = mapped_column(String(24), ForeignKey("items.id"), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AlbumEntry(Base):
    __tablename__ = "album_entries"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(24))
    color: Mapped[str] = mapped_column(String(16))
    personality: Mapped[str | None] = mapped_column(String(16), nullable=True)
    level: Mapped[int] = mapped_column(Integer)
    generation: Mapped[int] = mapped_column(Integer)
    hatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    graduated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    type: Mapped[str] = mapped_column(String(24))
    text: Mapped[str] = mapped_column(Text)


class GameAction(Base):
    """행동 이력 + 멱등키 (request_id)."""
    __tablename__ = "game_actions"
    __table_args__ = (UniqueConstraint("user_id", "request_id"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id"), index=True)
    action_type: Mapped[str] = mapped_column(String(32))
    target_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    request_id: Mapped[str] = mapped_column(String(64))
    payload_hash: Mapped[str] = mapped_column(String(64), default="")  # 같은 request_id·다른 payload 탐지
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CurrencyLedger(Base):
    """코인 원장 — 중복 지급/차감 추적·복구용."""
    __tablename__ = "currency_ledger"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id"), index=True)
    currency: Mapped[str] = mapped_column(String(16), default="coins")
    amount: Mapped[int] = mapped_column(Integer)
    balance_after: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(48))
    reference_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class InventoryLedger(Base):
    """아이템 원장 — 먹이·장식 증감 추적 (currency_ledger와 대칭)."""
    __tablename__ = "inventory_ledger"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id"), index=True)
    item_id: Mapped[str] = mapped_column(String(24))
    delta: Mapped[int] = mapped_column(Integer)
    quantity_after: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(48))
    reference_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SecurityEvent(Base):
    """부정행위 의심 이벤트 — 자동 제재 없이 누적 기록(운영자 검토용)."""
    __tablename__ = "security_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(32))  # idempotency_conflict | rate_limited | ...
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GameConfigVersion(Base):
    """원격 게임 설정 버전 — rules.py 기본값 위에 얹는 JSON 오버라이드."""
    __tablename__ = "game_config_versions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    version: Mapped[int] = mapped_column(Integer, unique=True)
    status: Mapped[str] = mapped_column(String(12), default="draft")  # draft | active | archived
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LiveEvent(Base):
    """기간 한정 이벤트 — config는 설정 오버라이드와 동형(기간에만 유효 설정 위에 겹침)."""
    __tablename__ = "live_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(48))
    config: Mapped[dict] = mapped_column(JSON, default=dict)  # {config:{}, variants:{}, ...}
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(12), default="active")  # active | cancelled
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Notice(Base):
    """앱 내 공지 — 기간·우선순위. 읽음 상태는 클라 로컬 저장."""
    __tablename__ = "notices"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(80))
    body: Mapped[str] = mapped_column(Text, default="")
    priority: Mapped[str] = mapped_column(String(12), default="normal")  # normal | urgent
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AdminAuditLog(Base):
    """어드민 쓰기 작업 감사 로그 — 사유·전후 값 기록."""
    __tablename__ = "admin_audit_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    action: Mapped[str] = mapped_column(String(48))
    target_type: Mapped[str] = mapped_column(String(32), default="")
    target_id: Mapped[str] = mapped_column(String(48), default="")
    before: Mapped[dict] = mapped_column(JSON, default=dict)
    after: Mapped[dict] = mapped_column(JSON, default=dict)
    reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MailboxMessage(Base):
    """우편함 — 졸업 달팽이 엽서·운영자 보상. 수령 멱등(claimed_at)."""
    __tablename__ = "mailbox_messages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="letter")  # letter | admin_reward | event
    title: Mapped[str] = mapped_column(String(48))
    body: Mapped[str] = mapped_column(Text, default="")
    rewards: Mapped[dict] = mapped_column(JSON, default=dict)  # {coins: 10}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuthSession(Base):
    """Refresh 토큰 세션 — 회전/폐기 관리."""
    __tablename__ = "auth_sessions"

    jti: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id"), index=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
