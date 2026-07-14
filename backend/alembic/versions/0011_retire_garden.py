"""햇살정원(garden) 배경 은퇴 — 저장값 일괄 default 전환 (13차 Phase 4 Contract).

Revision ID: 0011_retire_garden
Revises: 0010_skin_stage
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0011_retire_garden"
down_revision = "0010_skin_stage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "users" in insp.get_table_names():
        op.execute("UPDATE users SET background = 'default' WHERE background = 'garden'")


def downgrade() -> None:
    pass  # 데이터 정리 마이그레이션 — 되돌릴 원본 없음 (no-op)
