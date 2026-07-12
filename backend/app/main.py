"""Snail API 엔트리포인트."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .core.config import settings
from .core.database import Base, SessionLocal, engine
from .core.errors import ApiError, api_error_handler
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
    app = FastAPI(title="Snail API", version="0.1.0", docs_url="/docs" if settings.env != "prod" else None)

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
        # 개발/테스트 편의 — 운영은 Alembic 마이그레이션 사용 (backend/README.md)
        Base.metadata.create_all(engine)
        seed_items()

    return app


app = create_app()
