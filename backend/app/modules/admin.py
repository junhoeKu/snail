"""어드민 API — 원격 게임 설정 관리(버전/검증/활성화/롤백). 모든 쓰기는 감사 로그."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models
from ..core.database import get_db
from ..core.deps import require_admin
from ..core.errors import ApiError
from . import config_service, service

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _audit(db: Session, action: str, target_id: str, before: dict, after: dict, reason: str) -> None:
    db.add(models.AdminAuditLog(action=action, target_type="game_config",
                                target_id=target_id, before=before, after=after, reason=reason))


def _version_dict(v: models.GameConfigVersion) -> dict:
    return {"id": v.id, "version": v.version, "status": v.status, "note": v.note,
            "config": v.config, "created_at": service._aware(v.created_at).isoformat()}


@router.get("/config/effective")
def get_effective():
    """현재 반영된 유효 설정(기본값 ⊕ 활성 오버라이드)."""
    return config_service.effective()


@router.get("/config/versions")
def list_versions(db: Session = Depends(get_db)):
    rows = db.execute(select(models.GameConfigVersion)
                      .order_by(models.GameConfigVersion.version.desc())).scalars().all()
    return {"versions": [_version_dict(v) for v in rows]}


class ConfigDraftIn(BaseModel):
    config: dict          # {config:{}, variants:{}, foods:{}, stages:{}}
    note: str = ""


@router.post("/config/versions")
def create_draft(body: ConfigDraftIn, db: Session = Depends(get_db)):
    """새 draft 생성 — 저장 시 검증(활성화는 별도)."""
    errors = config_service.validate(body.config)
    if errors:
        raise ApiError(422, "config_invalid", "; ".join(errors))
    next_ver = (db.execute(select(func.max(models.GameConfigVersion.version))).scalar() or 0) + 1
    row = models.GameConfigVersion(version=next_ver, status="draft", config=body.config, note=body.note)
    db.add(row)
    _audit(db, "config_draft_create", str(next_ver), {}, {"note": body.note}, body.note)
    db.commit()
    return _version_dict(row)


class ReasonIn(BaseModel):
    reason: str = ""


@router.post("/config/versions/{version}/activate")
def activate_version(version: int, body: ReasonIn, db: Session = Depends(get_db)):
    """검증 통과 시 활성화 — 이전 활성은 archived, rules 전역에 즉시 반영. 롤백도 이 경로."""
    row = db.execute(select(models.GameConfigVersion)
                     .where(models.GameConfigVersion.version == version)).scalar_one_or_none()
    if row is None:
        raise ApiError(404, "not_found", "설정 버전을 찾을 수 없습니다.")
    errors = config_service.validate(row.config)
    if errors:
        raise ApiError(422, "config_invalid", "; ".join(errors))

    prev = config_service.active_overrides(db)
    prev_ver = prev.version if prev else 0
    if prev and prev.id != row.id:
        prev.status = "archived"
    row.status = "active"
    row.published_at = service.utcnow()
    _audit(db, "config_activate", str(version), {"prev_version": prev_ver},
           {"version": version}, body.reason)
    db.commit()
    config_service.apply_active(db)  # 즉시 반영
    return {"ok": True, "active_version": version, "effective": config_service.effective()}


@router.get("/audit")
def list_audit(db: Session = Depends(get_db)):
    rows = db.execute(select(models.AdminAuditLog)
                      .order_by(models.AdminAuditLog.created_at.desc()).limit(100)).scalars().all()
    return {"logs": [{"action": r.action, "target_id": r.target_id, "reason": r.reason,
                      "before": r.before, "after": r.after,
                      "created_at": service._aware(r.created_at).isoformat()} for r in rows]}
