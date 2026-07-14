"""게임 상태 조회 / 표시용 수치 / 위치 동기화 / 설정."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..core.config import settings
from ..core.database import get_db
from ..core.deps import get_current_user
from ..domain import rules
from . import service

router = APIRouter(prefix="/v1/game", tags=["game"])


@router.get("/state")
def get_state(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """상태 조회 시 lazy 정산(감쇠/접속 보상/부재 발견)이 함께 실행된다."""
    events = service.settle(db, user)
    result = service.state_payload(db, user, events)
    db.commit()
    return result


@router.get("/config")
def get_config():
    """클라이언트 표시용 수치 — 판정 소스(domain/rules)와 항상 일치."""
    return {
        "config": rules.CONFIG,
        "foods": rules.FOOD_DEFS,
        "variants": rules.VARIANTS,
        "decorations": {},  # [deprecated] 장식 시스템 제거 — 응답 형태 호환용 (다음 릴리스에 제거)
        "maps": rules.EXPLORE_MAPS,
        "missions": rules.MISSION_DEFS,
        "maxSnails": settings.max_snails,
    }


class PositionIn(BaseModel):
    positions: list[dict]  # [{id, rx, ry}]


@router.post("/sync-position")
def sync_position(body: PositionIn,
                  user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """위치는 경제 데이터가 아니므로 주기 저장만 한다 (판정 없음)."""
    for pos in body.positions[:16]:
        snail = db.get(models.Snail, str(pos.get("id", "")))
        if snail is None or snail.user_id != user.id:
            continue
        try:
            snail.pos_x = min(1.0, max(0.0, float(pos.get("rx", 0.5))))
            snail.pos_y = min(1.0, max(0.0, float(pos.get("ry", 0.5))))
        except (TypeError, ValueError):
            continue
    db.commit()
    return {"ok": True}


class SettingsIn(BaseModel):
    selected_food: str | None = None
    background: str | None = None
    sound_on: bool | None = None


@router.patch("/settings")
def update_settings(body: SettingsIn,
                    user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.selected_food is not None and body.selected_food in rules.FOOD_DEFS:
        user.selected_food = body.selected_food
    # garden은 은퇴 배경 — 저장돼 있던 값은 클라가 default로 표시한다 (Expand-Contract 유예)
    if body.background is not None and body.background in ("default", "pond", "fern"):
        user.background = body.background
    if body.sound_on is not None:
        user.sound_on = body.sound_on
    db.commit()
    return {"ok": True}
