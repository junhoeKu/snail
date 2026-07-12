#!/usr/bin/env bash
# sw-guard — 정적 자산(js/css/assets/index.html/manifest)이 바뀐 변경분에
# sw.js의 CACHE_VERSION 갱신이 함께 들어갔는지 검사한다.
# 서비스 워커가 cache-first라 버전을 안 올리면 기존 사용자에게 핫픽스가 전달되지 않는다.
#
# 사용: scripts/check-sw-version.sh <base-ref>
#   base-ref 미지정 시 origin/main 기준.
set -euo pipefail

BASE="${1:-origin/main}"
RANGE="$BASE...HEAD"

changed="$(git diff --name-only "$RANGE")"
asset_changed="$(echo "$changed" | grep -E '^(js/|css/|assets/|index\.html$|manifest\.json$)' || true)"

if [[ -z "$asset_changed" ]]; then
  echo "sw-guard: 자산 변경 없음 — 통과"
  exit 0
fi

# sw.js diff에 CACHE_VERSION 라인이 실제로 포함됐는지 확인
if git diff "$RANGE" -- sw.js | grep -q "CACHE_VERSION"; then
  echo "sw-guard: 자산 변경 + CACHE_VERSION 갱신 확인 — 통과"
  exit 0
fi

echo "❌ sw-guard 실패: 다음 자산이 변경됐지만 sw.js의 CACHE_VERSION이 갱신되지 않았습니다."
echo "$asset_changed" | sed 's/^/  - /'
echo ""
echo "sw.js의 CACHE_VERSION을 올려주세요 (예: snail-v1.0.3 → snail-v1.0.4)."
exit 1
