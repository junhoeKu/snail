"""10차 — 라이브 이벤트/공지 테이블 (방어적).

Revision ID: 0004_events_notices
Revises: 0003_config_mailbox
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_events_notices"
down_revision = "0003_config_mailbox"
branch_labels = None
depends_on = None


def _has_table(insp, name):
    return name in insp.get_table_names()


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not _has_table(insp, "live_events"):
        op.create_table(
            "live_events",
            sa.Column("id", sa.String(length=32), primary_key=True),
            sa.Column("title", sa.String(length=48), nullable=False),
            sa.Column("config", sa.JSON(), nullable=True),
            sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("status", sa.String(length=12), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_table(insp, "notices"):
        op.create_table(
            "notices",
            sa.Column("id", sa.String(length=32), primary_key=True),
            sa.Column("title", sa.String(length=80), nullable=False),
            sa.Column("body", sa.Text(), nullable=True),
            sa.Column("priority", sa.String(length=12), nullable=False, server_default="normal"),
            sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    for t in ("notices", "live_events"):
        if _has_table(insp, t):
            op.drop_table(t)
