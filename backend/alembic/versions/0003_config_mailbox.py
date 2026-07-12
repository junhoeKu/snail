"""10차 — 원격 설정/감사 로그/우편함 테이블 + users.last_letter_date.

방어적(idempotent): create_all과 공존하므로 존재하는 것은 건너뛴다.

Revision ID: 0003_config_mailbox
Revises: 0002_variant_remap
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_config_mailbox"
down_revision = "0002_variant_remap"
branch_labels = None
depends_on = None


def _has_table(insp, name):
    return name in insp.get_table_names()


def _has_column(insp, table, col):
    return _has_table(insp, table) and col in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())

    if _has_table(insp, "users") and not _has_column(insp, "users", "last_letter_date"):
        op.add_column("users", sa.Column("last_letter_date", sa.String(length=10), nullable=True))

    if not _has_table(insp, "game_config_versions"):
        op.create_table(
            "game_config_versions",
            sa.Column("id", sa.String(length=32), primary_key=True),
            sa.Column("version", sa.Integer(), nullable=False, unique=True),
            sa.Column("status", sa.String(length=12), nullable=False, server_default="draft"),
            sa.Column("config", sa.JSON(), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_table(insp, "admin_audit_logs"):
        op.create_table(
            "admin_audit_logs",
            sa.Column("id", sa.String(length=32), primary_key=True),
            sa.Column("action", sa.String(length=48), nullable=False),
            sa.Column("target_type", sa.String(length=32), nullable=True),
            sa.Column("target_id", sa.String(length=48), nullable=True),
            sa.Column("before", sa.JSON(), nullable=True),
            sa.Column("after", sa.JSON(), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_table(insp, "mailbox_messages"):
        op.create_table(
            "mailbox_messages",
            sa.Column("id", sa.String(length=32), primary_key=True),
            sa.Column("user_id", sa.String(length=32), sa.ForeignKey("users.id"), index=True),
            sa.Column("kind", sa.String(length=16), nullable=False, server_default="letter"),
            sa.Column("title", sa.String(length=48), nullable=False),
            sa.Column("body", sa.Text(), nullable=True),
            sa.Column("rewards", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    for t in ("mailbox_messages", "admin_audit_logs", "game_config_versions"):
        if _has_table(insp, t):
            op.drop_table(t)
    if _has_column(insp, "users", "last_letter_date"):
        op.drop_column("users", "last_letter_date")
