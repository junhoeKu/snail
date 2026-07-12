"""공용 의존성 — 인증된 사용자 해석 / 어드민 인증."""
import hmac

import jwt as pyjwt
from fastapi import Depends, Header
from sqlalchemy.orm import Session

from .. import models
from .config import settings
from .database import get_db
from .errors import ApiError
from .security import decode_token


def get_current_user(
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> models.User:
    if not authorization.startswith("Bearer "):
        raise ApiError(401, "unauthorized", "인증 토큰이 필요합니다.")
    try:
        payload = decode_token(authorization.removeprefix("Bearer "), "access")
    except pyjwt.PyJWTError:
        raise ApiError(401, "token_expired", "토큰이 만료되었거나 유효하지 않습니다.")

    user = db.get(models.User, payload["sub"])
    if user is None or user.deleted_at is not None:
        raise ApiError(401, "unauthorized", "계정을 찾을 수 없습니다.")
    return user


def require_admin(x_admin_token: str = Header(default="")) -> None:
    """어드민 API 보호 — 사용자 JWT와 완전 분리된 별도 토큰. 상수시간 비교."""
    expected = settings.admin_token
    if not expected:
        raise ApiError(403, "admin_disabled", "어드민 기능이 비활성화되어 있습니다.")
    if not hmac.compare_digest(x_admin_token, expected):
        raise ApiError(401, "admin_unauthorized", "어드민 인증에 실패했습니다.")
