#!/bin/sh
# snail.dorizone.com 배포 (Cloudflare Pages 프로젝트 "snail").
# 게임이 실제로 쓰는 파일만 임시 폴더에 모아 올린다 — 저장소 루트를 통째로 올리면 backend/·docs/ 까지 공개된다.
# 사전 조건: `npx wrangler login`. 자산을 바꿨다면 sw.js 의 CACHE_VERSION 을 먼저 올릴 것.
set -e
cd "$(dirname "$0")/.."
OUT=$(mktemp -d)
cp index.html config.js manifest.json sw.js "$OUT/"
cp -R css js assets "$OUT/"
npx wrangler pages deploy "$OUT" --project-name snail --branch main --commit-dirty=true
rm -rf "$OUT"
