"""관측성/보호 미들웨어 — 구조화 로그 + 사용자별 Rate Limit.

단일 인스턴스 전제의 인메모리 슬라이딩 윈도우. 다중 인스턴스로 확장하면
공유 저장소(Redis 등)로 옮긴다. PII·토큰은 로그에 남기지 않는다.
"""
import json
import logging
import time
import uuid
from collections import defaultdict, deque

import jwt as pyjwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from .config import settings

logger = logging.getLogger("snail")

WINDOW_SEC = 60
_hits: dict[tuple, deque] = defaultdict(deque)


def _client_ip(request) -> str:
    """리버스 프록시(Railway 등) 뒤에서는 request.client.host가 프록시 IP라 매 요청
    달라진다. X-Forwarded-For의 첫 값(원 클라이언트)을 우선 사용한다."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    client = request.client
    return client.host if client else "?"


def _client_key(request) -> str:
    """토큰 sub 우선(만료 무시 — 식별용), 없으면 클라이언트 IP."""
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        try:
            payload = pyjwt.decode(
                auth[7:], settings.jwt_secret, algorithms=["HS256"],
                options={"verify_exp": False},
            )
            return "u:" + str(payload.get("sub", "?"))
        except pyjwt.PyJWTError:
            pass
    return "ip:" + _client_ip(request)


class StructuredLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        start = time.monotonic()
        response = await call_next(request)
        duration_ms = int((time.monotonic() - start) * 1000)
        logger.info(json.dumps({
            "request_id": rid,
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": duration_ms,
        }))
        response.headers["X-Request-ID"] = rid
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """쓰기 요청만 제한: 행동 API 사용자별 분당 limit, 인증 API IP별 auth_limit."""

    def __init__(self, app, limit: int = 60, auth_limit: int = 20):
        super().__init__(app)
        self.limit = limit
        self.auth_limit = auth_limit

    async def dispatch(self, request, call_next):
        path = request.url.path
        if request.method in ("GET", "HEAD", "OPTIONS") or not path.startswith("/v1"):
            return await call_next(request)

        is_auth = path.startswith("/v1/auth")
        limit = self.auth_limit if is_auth else self.limit
        key = (_client_key(request), is_auth)
        now = time.monotonic()
        dq = _hits[key]
        while dq and dq[0] < now - WINDOW_SEC:
            dq.popleft()
        if len(dq) >= limit:
            logger.warning(json.dumps({"event": "rate_limited", "path": path}))
            return JSONResponse(
                status_code=429,
                content={"error": {"code": "rate_limited",
                                   "message": "요청이 너무 많아요. 잠시 후 다시 시도해주세요."}},
                headers={"Retry-After": "10"},
            )
        dq.append(now)
        return await call_next(request)
