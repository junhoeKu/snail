"""Snail API 엔트리포인트."""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .core.config import settings
from .core.database import Base, SessionLocal, engine
from .core.errors import ApiError, api_error_handler
from .core.middleware import RateLimitMiddleware, StructuredLogMiddleware
from .domain import rules
from .modules import actions, auth, game, migration


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
    logging.basicConfig(level=logging.INFO, format="%(message)s")
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
    )
    app.add_exception_handler(ApiError, api_error_handler)

    app.include_router(auth.router)
    app.include_router(game.router)
    app.include_router(actions.router)
    app.include_router(migration.router)

    @app.get("/healthz")
    def healthz():
        return {"ok": True, "env": settings.env}

    @app.on_event("startup")
    def startup():
        # 개발/테스트 편의로 누락 테이블 보강 (idempotent, 기존 컬럼은 건드리지 않음).
        # 운영 스키마 진화(컬럼 추가 등)는 Dockerfile의 `alembic upgrade head`가 담당한다.
        Base.metadata.create_all(engine)
        seed_items()

    return app


app = create_app()
