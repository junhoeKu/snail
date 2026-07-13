#!/usr/bin/env python3
"""release.py — 디자인 추가 후 '원클릭' 배포 파이프라인.

    python3 scripts/release.py "커밋 메시지"      # 처리 → 테스트 → 커밋 → 배포
    python3 scripts/release.py --dry-run          # 처리 + 테스트만 (커밋/푸시 안 함)

수행 단계:
  1) 아트 후처리: docs/art/characters/**/*.png → assets/characters/snail_{id}_{stage}.png
     (배경 flood-fill 제거 → 트림 → 512 정사각). 매핑은 docs/art/manifest.json.
  2) 등록 점검: manifest에 있으나 js/game.js·rules.py의 VARIANTS에 없는 변이를 경고한다
     (게임 확률/등급은 사람이 정하는 값이라 자동 등록하지 않는다).
  3) sw.js CACHE_VERSION + index.html 버전 라벨을 패치 단위로 자동 증가(캐시 버스팅).
  4) 테스트: node --check, jsdom 통합, game.test, (backend/.venv 있으면) pytest. 실패 시 중단.
  5) git add/commit/push origin main → GitHub Pages·Railway 자동 배포.

Pillow가 없으면 scripts/.venv-art에 자동 설치 후 스스로 재실행한다(추가 준비물 없음).
"""
import json
import os
import re
import subprocess
import sys
import unicodedata
from collections import deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_CH = os.path.join(ROOT, "docs/art/characters")
OUT_CH = os.path.join(ROOT, "assets/characters")
MANIFEST = os.path.join(ROOT, "docs/art/manifest.json")
SW = os.path.join(ROOT, "sw.js")
INDEX = os.path.join(ROOT, "index.html")
TOOLS_VENV = os.path.join(ROOT, "scripts/.venv-art")
TARGET = 512


# ── Pillow 부트스트랩 (없으면 전용 venv 만들고 재실행) ──────────────
def _ensure_pillow():
    try:
        import PIL  # noqa: F401
        return
    except ImportError:
        pass
    venv_py = os.path.join(TOOLS_VENV, "bin", "python")
    if os.path.abspath(sys.executable) == os.path.abspath(venv_py):
        print("Pillow 설치에 실패했습니다. 수동으로 확인해 주세요.", file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(venv_py):
        print("→ 아트 처리용 가상환경 준비 (scripts/.venv-art) …")
        subprocess.check_call([sys.executable, "-m", "venv", TOOLS_VENV])
    print("→ Pillow 설치 …")
    subprocess.check_call([venv_py, "-m", "pip", "install", "--quiet",
                           "--disable-pip-version-check", "pillow"])
    os.execv(venv_py, [venv_py, os.path.abspath(__file__), *sys.argv[1:]])


_ensure_pillow()
from PIL import Image  # noqa: E402  (부트스트랩 이후에만 import 가능)


# ── 1) 아트 후처리 ────────────────────────────────────────────────
def _is_bg(px):
    r, g, b = px[0], px[1], px[2]
    return min(r, g, b) > 196 and (max(r, g, b) - min(r, g, b)) < 16


def _remove_bg(im):
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    visited = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if _is_bg(px[x, y]):
                q.append((x, y)); visited[y * w + x] = 1
    for y in range(h):
        for x in (0, w - 1):
            if _is_bg(px[x, y]) and not visited[y * w + x]:
                q.append((x, y)); visited[y * w + x] = 1
    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny * w + nx] and _is_bg(px[nx, ny]):
                visited[ny * w + nx] = 1; q.append((nx, ny))
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            r, g, b, a = px[x, y]
            if a == 255 and min(r, g, b) > 208 and (max(r, g, b) - min(r, g, b)) < 14:
                if any(px[nx, ny][3] == 0 for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))):
                    px[x, y] = (r, g, b, 90)
    return im


def _trim_square(im, pad_ratio=0.04):
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    w, h = im.size
    side = int(max(w, h) * (1 + pad_ratio * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - w) // 2, (side - h) // 2), im)
    return canvas.resize((TARGET, TARGET), Image.LANCZOS)


def process_art():
    with open(MANIFEST, encoding="utf-8") as f:
        man = json.load(f)
    stages, variants = man["stages"], man["variants"]
    os.makedirs(OUT_CH, exist_ok=True)

    # 원본을 재귀 스캔 (등급 하위 폴더 포함). 파일명: "{이름} {단계} 달팽이.png"
    sources = {}  # (name, stage_kr) -> path
    unknown = set()
    for dirpath, _dirs, files in os.walk(SRC_CH):
        for fn in files:
            # macOS 파일명은 NFD(자모 분리)라 manifest의 NFC 키와 안 맞는다 → NFC로 정규화
            fn = unicodedata.normalize("NFC", fn)
            if not fn.endswith("달팽이.png"):
                continue
            base = fn[:-len(" 달팽이.png")] if fn.endswith(" 달팽이.png") else fn[:-len("달팽이.png")]
            parts = base.rsplit(" ", 1)
            if len(parts) != 2:
                continue
            name, stage_kr = parts[0].strip(), parts[1].strip()
            if stage_kr not in stages:
                continue
            if name not in variants:
                unknown.add(name); continue
            sources[(name, stage_kr)] = os.path.join(dirpath, fn)

    processed, missing = 0, []
    for name, vid in variants.items():
        for stage_kr, stage_id in stages.items():
            src = sources.get((name, stage_kr))
            out = os.path.join(OUT_CH, f"snail_{vid}_{stage_id}.png")
            if not src:
                if not os.path.exists(out):
                    missing.append(f"{name}({vid}) {stage_kr}")
                continue
            _trim_square(_remove_bg(Image.open(src))).save(out, optimize=True)
            processed += 1

    print(f"✓ 스프라이트 {processed}장 처리")
    if unknown:
        print("⚠ manifest에 없는 원본(무시됨) — 추가하려면 manifest.json에 매핑하세요:")
        for n in sorted(unknown):
            print(f"    - {n}")
    if missing:
        print("⚠ 원본이 없어 갱신하지 못한 스프라이트(기존 파일 유지):")
        for m in missing:
            print(f"    - {m}")
    return variants


# ── 2) 게임 등록 점검 ─────────────────────────────────────────────
def check_registration(variants):
    game_src = open(os.path.join(ROOT, "js/game.js"), encoding="utf-8").read()
    rules_src = open(os.path.join(ROOT, "backend/app/domain/rules.py"), encoding="utf-8").read()
    unreg = [vid for vid in variants.values()
             if f'"{vid}"' not in rules_src and f"'{vid}'" not in game_src
             and f"{vid}:" not in game_src]
    if unreg:
        print("⚠ 스프라이트는 준비됐지만 게임에 아직 등록되지 않은 변이:")
        for vid in unreg:
            print(f"    - {vid}  (js/game.js·rules.py VARIANTS에 확률/등급 등록 필요)")
        print("   → 이 변이들은 확률이 정해지기 전까지 게임에 등장하지 않습니다.")
    return unreg


# ── 3) 버전 패치 증가 ─────────────────────────────────────────────
def bump_version():
    sw = open(SW, encoding="utf-8").read()
    m = re.search(r"CACHE_VERSION = 'snail-v(\d+)\.(\d+)\.(\d+)'", sw)
    if not m:
        print("sw.js에서 CACHE_VERSION을 찾지 못했습니다.", file=sys.stderr); sys.exit(1)
    major, minor, patch = int(m[1]), int(m[2]), int(m[3]) + 1
    new = f"{major}.{minor}.{patch}"
    old = f"{m[1]}.{m[2]}.{m[3]}"
    open(SW, "w", encoding="utf-8").write(sw.replace(f"snail-v{old}", f"snail-v{new}"))
    idx = open(INDEX, encoding="utf-8").read()
    open(INDEX, "w", encoding="utf-8").write(idx.replace(f"Snail v{old}", f"Snail v{new}"))
    print(f"✓ 버전 v{old} → v{new}")
    return new


# ── 4) 테스트 ────────────────────────────────────────────────────
def run_tests():
    print("→ 테스트 실행 …")
    for f in ["js/game.js", "js/app.js", "js/share.js", "js/db.js", "js/dex.js"]:
        subprocess.check_call(["node", "--check", os.path.join(ROOT, f)])
    subprocess.check_call(["node", os.path.join(ROOT, "tests/game.test.js")])
    subprocess.check_call(["node", os.path.join(ROOT, "tests/integration.test.js")])
    venv_py = os.path.join(ROOT, "backend/.venv/bin/python")
    if os.path.exists(venv_py):
        subprocess.check_call([venv_py, "-m", "pytest", "-q"], cwd=os.path.join(ROOT, "backend"))
    print("✓ 테스트 통과")


# ── 5) 배포 ──────────────────────────────────────────────────────
def deploy(version, message):
    subprocess.check_call(["git", "add", "-A"], cwd=ROOT)
    if not subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode:
        print("커밋할 변경 사항이 없습니다."); return
    msg = message or f"chore(art): 스프라이트 갱신 및 배포 (v{version})"
    subprocess.check_call(["git", "commit", "-m", msg], cwd=ROOT)
    branch = subprocess.check_output(["git", "branch", "--show-current"], cwd=ROOT).decode().strip()
    subprocess.check_call(["git", "push", "origin", branch], cwd=ROOT)
    print(f"🚀 push 완료 ({branch}) — GitHub Pages·Railway가 자동 배포합니다.")


def main():
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    dry = "--dry-run" in sys.argv[1:]
    message = args[0] if args else None

    variants = process_art()
    check_registration(variants)
    version = bump_version()
    run_tests()
    if dry:
        print("\n--dry-run: 커밋/푸시를 건너뜁니다. (버전·스프라이트 변경은 워킹트리에 남아 있음)")
        return
    deploy(version, message)


if __name__ == "__main__":
    main()
