#!/usr/bin/env bash
# PostgreSQL 논리 백업 — 관리형 DB의 자동 백업/PITR을 1순위로 쓰고,
# 이 스크립트는 배포 전·수동 스냅샷용 보조 수단이다.
#
# 사용:
#   DATABASE_URL=postgresql://user:pass@host:5432/db ./scripts/backup.sh [출력디렉토리]
#
# 복구 리허설(스테이징):
#   createdb snail_restore
#   gunzip -c backups/snail-YYYYmmdd-HHMMSS.sql.gz | psql postgresql://.../snail_restore
#   DATABASE_URL=postgresql://.../snail_restore pytest -q   # smoke
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL 환경변수가 필요합니다." >&2
  exit 1
fi

OUT_DIR="${1:-backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/snail-$STAMP.sql.gz"

echo "백업 시작 → $FILE"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip > "$FILE"
echo "백업 완료: $(du -h "$FILE" | cut -f1)"

# 보존: 최근 14개만 유지
ls -1t "$OUT_DIR"/snail-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "오래된 백업 정리 완료 (최근 14개 유지)."
