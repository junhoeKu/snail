"""서식지 드롭 먹이 지속 — users.dropped_foods (13차 Phase 2).

Revision ID: 0009_dropped_foods
Revises: 0008_minigame_quiz
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0009_dropped_foods"
down_revision = "0008_minigame_quiz"
branch_labels = None
depends_on = None


def _has_column(insp, table, col):
    return table in insp.get_table_names() and col in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not _has_column(insp, "users", "dropped_foods"):
        op.add_column("users", sa.Column("dropped_foods", sa.JSON(), nullable=True))


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if _has_column(insp, "users", "dropped_foods"):
        op.drop_column("users", "dropped_foods")
