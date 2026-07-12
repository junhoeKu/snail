"""공지 공개 조회 — 인증 불요. 읽음 상태는 클라 로컬 저장."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..core.database import get_db
from . import service

router = APIRouter(prefix="/v1/notices", tags=["notices"])


@router.get("/active")
def active_notices(db: Session = Depends(get_db)):
    now = service.utcnow()
    rows = db.execute(select(models.Notice)
                      .order_by(models.Notice.created_at.desc()).limit(50)).scalars().all()
    active = [n for n in rows
              if service._aware(n.starts_at) <= now
              and (n.ends_at is None or service._aware(n.ends_at) > now)]
    return {"notices": [{"id": n.id, "title": n.title, "body": n.body,
                         "priority": n.priority,
                         "created_at": service._aware(n.created_at).isoformat()} for n in active]}
