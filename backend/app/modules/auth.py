"""인증 — 게스트 생성 / 토큰 회전 / Google 연결."""
import jwt as pyjwt
import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..core.config import settings
from ..core.database import get_db
from ..core.deps import get_current_user
from ..core.errors import ApiError
from ..core.security import create_access_token, create_refresh_token, decode_token
from . import service

router = APIRouter(prefix="/v1/auth", tags=["auth"])


class TokenPair(BaseModel):
    accessToken: str
    refreshToken: str
    userId: str


def _issue_tokens(db: Session, user: models.User) -> TokenPair:
    refresh, jti = create_refresh_token(user.id)
    db.add(models.AuthSession(jti=jti, user_id=user.id))
    return TokenPair(accessToken=create_access_token(user.id), refreshToken=refresh, userId=user.id)


@router.post("/guest", response_model=TokenPair)
def create_guest(db: Session = Depends(get_db)) -> TokenPair:
    """게스트도 정상 users 레코드 — 시작 자원은 클라이언트 로컬 기본값과 동일."""
    user = models.User(auth_type="guest")
    db.add(user)
    db.flush()
    service.set_item(db, user, "lettuce", 3)
    service.new_egg(db, user)
    tokens = _issue_tokens(db, user)
    db.commit()
    return tokens


class RefreshIn(BaseModel):
    refreshToken: str


@router.post("/refresh", response_model=TokenPair)
def refresh(body: RefreshIn, db: Session = Depends(get_db)) -> TokenPair:
    """Refresh 회전: 기존 세션 폐기 후 새 쌍 발급."""
    try:
        payload = decode_token(body.refreshToken, "refresh")
    except pyjwt.PyJWTError:
        raise ApiError(401, "refresh_invalid", "다시 로그인해주세요.")

    session = db.get(models.AuthSession, payload["jti"])
    if session is None or session.revoked:
        raise ApiError(401, "refresh_revoked", "세션이 만료되었습니다. 다시 로그인해주세요.")
    user = db.get(models.User, payload["sub"])
    if user is None:
        raise ApiError(401, "unauthorized", "계정을 찾을 수 없습니다.")

    session.revoked = True
    tokens = _issue_tokens(db, user)
    db.commit()
    return tokens


class GoogleLinkIn(BaseModel):
    idToken: str


@router.post("/link/google", response_model=TokenPair)
def link_google(
    body: GoogleLinkIn,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TokenPair:
    """게스트 계정을 유지한 채 Google 인증 수단만 연결한다 (데이터 이관 없음)."""
    if not settings.google_client_id:
        raise ApiError(501, "google_not_configured", "서버에 Google 클라이언트가 설정되지 않았습니다.")

    resp = httpx.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": body.idToken}, timeout=10)
    if resp.status_code != 200:
        raise ApiError(401, "google_invalid", "Google 토큰 검증에 실패했습니다.")
    info = resp.json()
    if info.get("aud") != settings.google_client_id:
        raise ApiError(401, "google_invalid", "Google 클라이언트가 일치하지 않습니다.")

    google_id = info["sub"]
    existing = db.execute(select(models.User).where(
        models.User.provider == "google",
        models.User.provider_user_id == google_id,
    )).scalar_one_or_none()
    if existing is not None and existing.id != user.id:
        # 자동 병합 금지 — 프론트가 충돌 화면을 표시한다
        raise ApiError(409, "social_conflict", "이미 다른 계정에 연결된 Google 계정입니다.")

    user.auth_type = "social"
    user.provider = "google"
    user.provider_user_id = google_id
    user.nickname = user.nickname or info.get("name")
    tokens = _issue_tokens(db, user)
    db.commit()
    return tokens
