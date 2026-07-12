"""9차 안정성 — revision/payload_hash 컬럼 + inventory_ledger/security_events 테이블.

방어적(idempotent) 마이그레이션: startup의 create_all과 공존해야 하므로
이미 존재하는 컬럼/테이블은 건너뛴다. 기존 8차 운영 DB와 신규 DB 모두에서 안전하다.

Revision ID: 0001_v9_stability
Revises:
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_v9_stability"
down_revision = None
branch_labels = None
depends_on = None


def _has_table(insp, name: str) -> bool:
    return name in insp.get_table_names()


def _has_column(insp, table: str, column: str) -> bool:
    if not _has_table(insp, table):
        return False
    return column in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())

    if _has_table(insp, "users") and not _has_column(insp, "users", "revision"):
        op.add_column("users", sa.Column("revision", sa.Integer(), nullable=False, server_default="0"))
    if _has_table(insp, "game_actions") and not _has_column(insp, "game_actions", "payload_hash"):
        op.add_column("game_actions", sa.Column("payload_hash", sa.String(length=64), nullable=False, server_default=""))

    if not _has_table(insp, "inventory_ledger"):
        op.create_table(
            "inventory_ledger",
            sa.Column("id", sa.String(length=32), primary_key=True),
            sa.Column("user_id", sa.String(length=32), sa.ForeignKey("users.id"), index=True),
            sa.Column("item_id", sa.String(length=24), nullable=False),
            sa.Column("delta", sa.Integer(), nullable=False),
            sa.Column("quantity_after", sa.Integer(), nullable=False),
            sa.Column("reason", sa.String(length=48), nullable=False),
            sa.Column("reference_id", sa.String(length=32), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_table(insp, "security_events"):
        op.create_table(
            "security_events",
            sa.Column("id", sa.String(length=32), primary_key=True),
            sa.Column("user_id", sa.String(length=32), nullable=True, index=True),
            sa.Column("kind", sa.String(length=32), nullable=False),
            sa.Column("detail", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if _has_table(insp, "security_events"):
        op.drop_table("security_events")
    if _has_table(insp, "inventory_ledger"):
        op.drop_table("inventory_ledger")
    if _has_column(insp, "game_actions", "payload_hash"):
        op.drop_column("game_actions", "payload_hash")
    if _has_column(insp, "users", "revision"):
        op.drop_column("users", "revision")
