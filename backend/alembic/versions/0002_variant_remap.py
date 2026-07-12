"""은퇴 변이 색 이전 — 황금(golden)→노란색(yellow), 적갈색(russet)→붉은색(red).

변이 팔레트 재편에 따라 기존 서버 데이터의 은퇴 색을 후속 색으로 옮긴다.
snails.color 와 album_entries.color 양쪽. 방어적(테이블/컬럼 존재 시에만).

Revision ID: 0002_variant_remap
Revises: 0001_v9_stability
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_variant_remap"
down_revision = "0001_v9_stability"
branch_labels = None
depends_on = None

REMAP = {"golden": "yellow", "russet": "red"}


def _has_table(insp, name: str) -> bool:
    return name in insp.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for table in ("snails", "album_entries"):
        if not _has_table(insp, table):
            continue
        for old, new in REMAP.items():
            bind.execute(
                sa.text(f"UPDATE {table} SET color = :new WHERE color = :old"),
                {"new": new, "old": old},
            )


def downgrade() -> None:
    # 되돌리기 불가(신·구 색이 다대일 아님이라 안전하지 않음) — no-op
    pass
