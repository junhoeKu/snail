"""어드민 API — 원격 게임 설정/라이브 이벤트/공지 관리. 모든 쓰기는 감사 로그."""
from datetime import datetime

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


# ── 라이브 이벤트 ───────────────────────────────────────

class EventIn(BaseModel):
    title: str
    config: dict            # 설정 오버라이드 동형
    starts_at: datetime
    ends_at: datetime
    reason: str = ""


@router.get("/events")
def list_events(db: Session = Depends(get_db)):
    rows = db.execute(select(models.LiveEvent)
                      .order_by(models.LiveEvent.starts_at.desc())).scalars().all()
    return {"events": [{"id": e.id, "title": e.title, "status": e.status,
                        "config": e.config,
                        "starts_at": service._aware(e.starts_at).isoformat(),
                        "ends_at": service._aware(e.ends_at).isoformat()} for e in rows]}


@router.post("/events")
def create_event(body: EventIn, db: Session = Depends(get_db)):
    """이벤트 생성 — config는 활성 설정 위에 겹쳐도 검증(확률 합 등) 통과해야 한다."""
    if body.ends_at <= body.starts_at:
        raise ApiError(422, "bad_range", "종료가 시작보다 빨라요.")
    errors = config_service.validate(body.config)
    if errors:
        raise ApiError(422, "event_invalid", "; ".join(errors))
    ev = models.LiveEvent(title=body.title, config=body.config,
                          starts_at=body.starts_at, ends_at=body.ends_at, status="active")
    db.add(ev)
    _audit(db, "event_create", body.title, {}, {"config": body.config}, body.reason)
    db.commit()
    return {"ok": True, "id": ev.id}


@router.post("/events/{event_id}/cancel")
def cancel_event(event_id: str, body: ReasonIn, db: Session = Depends(get_db)):
    ev = db.get(models.LiveEvent, event_id)
    if ev is None:
        raise ApiError(404, "not_found", "이벤트를 찾을 수 없습니다.")
    ev.status = "cancelled"
    _audit(db, "event_cancel", event_id, {"status": "active"}, {"status": "cancelled"}, body.reason)
    db.commit()
    config_service.refresh_for_request(db)  # 즉시 무효화
    return {"ok": True}


# ── 공지 ────────────────────────────────────────────────

class NoticeIn(BaseModel):
    title: str
    body: str = ""
    priority: str = "normal"     # normal | urgent
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    reason: str = ""


@router.post("/notices")
def create_notice(body: NoticeIn, db: Session = Depends(get_db)):
    n = models.Notice(title=body.title, body=body.body,
                      priority=("urgent" if body.priority == "urgent" else "normal"),
                      starts_at=body.starts_at or service.utcnow(), ends_at=body.ends_at)
    db.add(n)
    _audit(db, "notice_create", body.title, {}, {"priority": n.priority}, body.reason)
    db.commit()
    return {"ok": True, "id": n.id}


@router.post("/notices/{notice_id}/end")
def end_notice(notice_id: str, body: ReasonIn, db: Session = Depends(get_db)):
    n = db.get(models.Notice, notice_id)
    if n is None:
        raise ApiError(404, "not_found", "공지를 찾을 수 없습니다.")
    n.ends_at = service.utcnow()
    _audit(db, "notice_end", notice_id, {}, {}, body.reason)
    db.commit()
    return {"ok": True}


@router.get("/audit")
def list_audit(db: Session = Depends(get_db)):
    rows = db.execute(select(models.AdminAuditLog)
                      .order_by(models.AdminAuditLog.created_at.desc()).limit(100)).scalars().all()
    return {"logs": [{"action": r.action, "target_id": r.target_id, "reason": r.reason,
                      "before": r.before, "after": r.after,
                      "created_at": service._aware(r.created_at).isoformat()} for r in rows]}
