"""미니게임 — users.minigame_quiz (퀴즈 하루 제한).

Revision ID: 0008_minigame_quiz
Revises: 0007_minigame_race
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0008_minigame_quiz"
down_revision = "0007_minigame_race"
branch_labels = None
depends_on = None


def _has_column(insp, table, col):
    return table in insp.get_table_names() and col in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not _has_column(insp, "users", "minigame_quiz"):
        op.add_column("users", sa.Column("minigame_quiz", sa.JSON(), nullable=True))


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if _has_column(insp, "users", "minigame_quiz"):
        op.drop_column("users", "minigame_quiz")
