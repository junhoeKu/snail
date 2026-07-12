"""Snail API 엔트리포인트."""
import logging
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .core.config import settings
from .core.database import Base, SessionLocal, engine
from .core.errors import ApiError, api_error_handler
from .core.middleware import RateLimitMiddleware, StructuredLogMiddleware
from .domain import rules
from .modules import actions, admin, auth, config_service, game, mailbox, migration


def seed_items() -> None:
    """먹이·장식 카탈로그 시드 (멱등)."""
    with SessionLocal() as db:
        for food_id, d in rules.FOOD_DEFS.items():
            if db.get(models.Item, food_id) is None:
                db.add(models.Item(id=food_id, item_type="food", name=d["label"], meta=d))
        for deco_id, d in rules.DECORATIONS.items():
            if db.get(models.Item, deco_id) is None:
                db.add(models.Item(id=deco_id, item_type="decoration", name=d["label"], meta=d))
        db.commit()


def create_app() -> FastAPI:
    # 로그는 stdout 한 스트림으로 일원화한다 — access 로그(uvicorn, stdout)와
    # 구조화 로그(stderr)가 갈라지면 로그 수집기가 서로 다른 레벨로 태깅해 혼란을 준다.
    # uvicorn access 로그는 Dockerfile의 --no-access-log로 끄고 이 구조화 로그로 대체한다.
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
    app = FastAPI(title="Snail API", version="0.1.0", docs_url="/docs" if settings.env != "prod" else None)

    # 미들웨어는 나중에 add한 것이 바깥 계층 — CORS를 가장 바깥에 둬서
    # 429/500 응답에도 CORS 헤더가 실려 브라우저가 본문을 읽을 수 있게 한다.
    app.add_middleware(RateLimitMiddleware,
                       limit=settings.rate_limit_per_min,
                       auth_limit=settings.rate_limit_auth_per_min)
    app.add_middleware(StructuredLogMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        max_age=600,  # preflight(OPTIONS) 결과를 10분 캐시 — 매 요청 preflight 방지
    )
    app.add_exception_handler(ApiError, api_error_handler)

    app.include_router(auth.router)
    app.include_router(game.router)
    app.include_router(actions.router)
    app.include_router(migration.router)
    app.include_router(mailbox.router)
    app.include_router(admin.router)

    @app.get("/healthz")
    def healthz():
        return {"ok": True, "env": settings.env}

    @app.on_event("startup")
    def startup():
        # 개발/테스트 편의로 누락 테이블 보강 (idempotent, 기존 컬럼은 건드리지 않음).
        # 운영 스키마 진화(컬럼 추가 등)는 Dockerfile의 `alembic upgrade head`가 담당한다.
        Base.metadata.create_all(engine)
        seed_items()
        with SessionLocal() as db:
            config_service.apply_active(db)  # 활성 원격 설정을 rules 전역에 반영

    return app


app = create_app()
