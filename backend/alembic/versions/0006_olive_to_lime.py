"""변이 팔레트 확장 — 올리브(olive)→라임(lime) 이전. 검정/라임/소라 신규 색 추가.

기존 서버 데이터의 olive 색만 후속 색(lime)으로 옮긴다(신규 색은 부화로 자연 등장).

Revision ID: 0006_olive_to_lime
Revises: 0005_user_suspend
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_olive_to_lime"
down_revision = "0005_user_suspend"
branch_labels = None
depends_on = None


def _has_table(insp, name):
    return name in insp.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for table in ("snails", "album_entries"):
        if _has_table(insp, table):
            bind.execute(sa.text(f"UPDATE {table} SET color = 'lime' WHERE color = 'olive'"))


def downgrade() -> None:
    pass
