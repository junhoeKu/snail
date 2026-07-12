"""JWT 토큰 — Access(짧은 만료) + Refresh(회전, 서버 폐기 가능)."""
import uuid
from datetime import datetime, timedelta, timezone

import jwt

from .config import settings


def _encode(payload: dict, ttl: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {**payload, "iat": now, "exp": now + ttl}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_access_token(user_id: str) -> str:
    return _encode({"sub": user_id, "typ": "access"}, timedelta(minutes=settings.access_ttl_min))


def create_refresh_token(user_id: str) -> tuple[str, str]:
    """(token, jti) — jti는 세션 테이블에 저장해 폐기 가능하게 한다."""
    jti = uuid.uuid4().hex
    token = _encode({"sub": user_id, "typ": "refresh", "jti": jti}, timedelta(days=settings.refresh_ttl_days))
    return token, jti


def decode_token(token: str, expected_type: str) -> dict:
    payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    if payload.get("typ") != expected_type:
        raise jwt.InvalidTokenError("wrong token type")
    return payload
