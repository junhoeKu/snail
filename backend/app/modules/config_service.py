"""원격 게임 설정 — rules.py 기본값 위에 활성 오버라이드를 병합해 적용/검증한다.

설계: 활성 설정을 rules 전역(CONFIG/VARIANTS/FOOD_DEFS/STAGE_LEVELS)에 병합 적용한다.
판정 함수는 rules 전역을 그대로 참조하므로 시그니처를 바꿀 필요가 없다(단일 인스턴스 전제).
기본값 스냅샷을 보관해 활성화/롤백 때마다 DEFAULTS ⊕ overrides 로 재구성한다.
"""
import copy

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..domain import rules

# 오버라이드가 덮을 수 있는 rules 전역의 원본 스냅샷 (프로세스 시작 시 1회 캡처)
_DEFAULTS = {
    "config": copy.deepcopy(rules.CONFIG),
    "variants": copy.deepcopy(rules.VARIANTS),
    "foods": copy.deepcopy(rules.FOOD_DEFS),
    "stages": copy.deepcopy(rules.STAGE_LEVELS),
}

_active_version = 0  # 관측용 — 현재 반영된 설정 버전


def defaults() -> dict:
    return copy.deepcopy(_DEFAULTS)


def _merge(overrides: dict) -> dict:
    """DEFAULTS ⊕ overrides — 기존 키만 덮는다(새 키/ID 추가 금지)."""
    merged = defaults()
    ov = overrides or {}
    # config: 스칼라 키만
    for k, v in (ov.get("config") or {}).items():
        if k in merged["config"]:
            merged["config"][k] = v
    # variants/foods: 기존 변이/먹이의 기존 속성만
    for section in ("variants", "foods"):
        for item_id, patch in (ov.get(section) or {}).items():
            if item_id in merged[section] and isinstance(patch, dict):
                for pk, pv in patch.items():
                    if pk in merged[section][item_id]:
                        merged[section][item_id][pk] = pv
    # stages: 기존 경계만
    for k, v in (ov.get("stages") or {}).items():
        if k in merged["stages"]:
            merged["stages"][k] = v
    return merged


def validate(overrides: dict) -> list[str]:
    """활성화 전 검증 — 실패 항목 목록 반환(빈 리스트면 통과)."""
    errors: list[str] = []
    merged = _merge(overrides)
    cfg = merged["config"]
    variants = merged["variants"]
    foods = merged["foods"]
    stages = merged["stages"]

    # 알 수 없는 키/ID 참조 차단
    ov = overrides or {}
    for k in (ov.get("config") or {}):
        if k not in _DEFAULTS["config"]:
            errors.append(f"알 수 없는 config 키: {k}")
    for section in ("variants", "foods"):
        for item_id in (ov.get(section) or {}):
            if item_id not in _DEFAULTS[section]:
                errors.append(f"알 수 없는 {section} ID: {item_id}")

    # 변이 확률 합 == 1
    chance_sum = sum(v.get("chance", 0) for v in variants.values())
    if abs(chance_sum - 1.0) > 1e-6:
        errors.append(f"변이 확률 합이 1이 아님: {chance_sum:.4f}")

    # 음수 금지 (가격/보상/회복/exp)
    for k in ("EXP_PER_LEVEL", "DECAY_HUNGER", "DECAY_HAPPINESS", "DAILY_COINS",
              "FEED_COINS", "GRADUATE_COINS", "GRADUATE_MIN_LEVEL"):
        if k in cfg and cfg[k] < 0:
            errors.append(f"{k} 음수 불가: {cfg[k]}")
    if cfg.get("EXP_PER_LEVEL", 1) <= 0:
        errors.append("EXP_PER_LEVEL 은 1 이상이어야 함")
    for fid, f in foods.items():
        for pk in ("price", "hunger", "exp"):
            if f.get(pk, 0) < 0:
                errors.append(f"먹이 {fid}.{pk} 음수 불가")

    # 단계 경계 단조 증가 (baby < junior < adult ≤ 졸업)
    if stages.get("junior", 1) >= stages.get("adult", 2):
        errors.append("단계 경계 역전: junior >= adult")
    if cfg.get("GRADUATE_MIN_LEVEL", 99) < stages.get("adult", 0):
        errors.append("졸업 레벨이 adult 경계보다 낮음")

    return errors


def apply_overrides(overrides: dict, version: int = 0) -> None:
    """rules 전역을 DEFAULTS ⊕ overrides 로 갱신 (기존 키만)."""
    global _active_version
    merged = _merge(overrides)
    for target, key in ((rules.CONFIG, "config"), (rules.VARIANTS, "variants"),
                        (rules.FOOD_DEFS, "foods"), (rules.STAGE_LEVELS, "stages")):
        target.clear()
        target.update(merged[key])
    _active_version = version


def active_overrides(db: Session) -> models.GameConfigVersion | None:
    return db.execute(select(models.GameConfigVersion)
                      .where(models.GameConfigVersion.status == "active")).scalar_one_or_none()


def apply_active(db: Session) -> None:
    """DB의 활성 설정을 반영 (앱 시작·활성화 시 호출). 없으면 기본값 복원."""
    row = active_overrides(db)
    apply_overrides(row.config if row else {}, row.version if row else 0)


def effective() -> dict:
    """현재 반영된 유효 설정(표시/검증용) — rules 전역 그대로."""
    return {
        "version": _active_version,
        "config": copy.deepcopy(rules.CONFIG),
        "variants": copy.deepcopy(rules.VARIANTS),
        "foods": copy.deepcopy(rules.FOOD_DEFS),
        "stages": copy.deepcopy(rules.STAGE_LEVELS),
    }
