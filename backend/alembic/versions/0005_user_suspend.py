"""10차 — users.suspended_at (운영자 정지).

Revision ID: 0005_user_suspend
Revises: 0004_events_notices
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_user_suspend"
down_revision = "0004_events_notices"
branch_labels = None
depends_on = None


def _has_column(insp, table, col):
    return table in insp.get_table_names() and col in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not _has_column(insp, "users", "suspended_at"):
        op.add_column("users", sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if _has_column(insp, "users", "suspended_at"):
        op.drop_column("users", "suspended_at")
