"""우편함 — 졸업 달팽이 엽서·보상 조회/수령. 수령은 멱등(claimed_at)."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..core.database import get_db
from ..core.deps import get_current_user
from ..core.errors import ApiError
from . import service

router = APIRouter(prefix="/v1/mailbox", tags=["mailbox"])


def _msg_dict(m: models.MailboxMessage) -> dict:
    return {
        "id": m.id, "kind": m.kind, "title": m.title, "body": m.body,
        "rewards": m.rewards or {},
        "claimed": m.claimed_at is not None,
        "created_at": service._aware(m.created_at).isoformat(),
    }


@router.get("")
def list_mail(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """미수령 우선, 최신순. 만료된 미수령은 숨긴다(lazy)."""
    now = service.utcnow()
    rows = db.execute(select(models.MailboxMessage)
                      .where(models.MailboxMessage.user_id == user.id)
                      .order_by(models.MailboxMessage.claimed_at.isnot(None),
                                models.MailboxMessage.created_at.desc())).scalars().all()
    visible = [m for m in rows
               if m.claimed_at is not None or m.expires_at is None
               or service._aware(m.expires_at) > now]
    return {"messages": [_msg_dict(m) for m in visible]}


@router.post("/{message_id}/claim")
def claim(message_id: str,
          user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """보상 수령 — 멱등: 이미 수령했으면 재지급 없이 반환."""
    service.lock_user(db, user)
    m = db.get(models.MailboxMessage, message_id)
    if m is None or m.user_id != user.id:
        raise ApiError(404, "not_found", "편지를 찾을 수 없습니다.")
    if m.claimed_at is not None:
        return {"ok": True, "already": True, "coins": user.coins}

    coins = (m.rewards or {}).get("coins", 0)
    if coins:
        service.add_coins(db, user, coins, "graduate_letter", m.id)
    for item_id, qty in (m.rewards or {}).get("items", {}).items():
        service.add_item(db, user, item_id, qty, "mail_reward", m.id)
    m.claimed_at = service.utcnow()
    service.bump_revision(user)
    db.commit()
    return {"ok": True, "coins": user.coins, "rewards": m.rewards or {}}
