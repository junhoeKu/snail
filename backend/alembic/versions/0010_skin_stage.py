"""모습 바꾸기(연출 전용) — snails.skin_stage (13차 Phase 3).

Revision ID: 0010_skin_stage
Revises: 0009_dropped_foods
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0010_skin_stage"
down_revision = "0009_dropped_foods"
branch_labels = None
depends_on = None


def _has_column(insp, table, col):
    return table in insp.get_table_names() and col in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not _has_column(insp, "snails", "skin_stage"):
        op.add_column("snails", sa.Column("skin_stage", sa.String(12), nullable=True))


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if _has_column(insp, "snails", "skin_stage"):
        op.drop_column("snails", "skin_stage")
