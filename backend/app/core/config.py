"""환경 설정 — 값은 환경변수로만 주입 (코드에 시크릿 금지)."""
import os
from dataclasses import dataclass, field


def _origins() -> list[str]:
    raw = os.environ.get(
        "CORS_ORIGINS",
        "https://junhoeku.github.io,http://localhost:31111,http://127.0.0.1:31111",
    )
    return [o.strip() for o in raw.split(",") if o.strip()]


@dataclass(frozen=True)
class Settings:
    env: str = os.environ.get("ENV", "dev")
    database_url: str = os.environ.get("DATABASE_URL", "sqlite:///./snail_dev.db")
    jwt_secret: str = os.environ.get("JWT_SECRET", "dev-secret-change-me")
    access_ttl_min: int = int(os.environ.get("ACCESS_TTL_MIN", "30"))
    refresh_ttl_days: int = int(os.environ.get("REFRESH_TTL_DAYS", "30"))
    cors_origins: list[str] = field(default_factory=_origins)
    google_client_id: str = os.environ.get("GOOGLE_CLIENT_ID", "")
    default_timezone: str = os.environ.get("DEFAULT_TZ", "Asia/Seoul")
    # 마이그레이션 검증 상한 — 하드코딩 금지 (9차 생태계에서 8로 상향 예정)
    max_snails: int = int(os.environ.get("MAX_SNAILS", "3"))
    migration_coin_cap: int = int(os.environ.get("MIGRATION_COIN_CAP", "100000"))
    # Rate Limit (분당) — 행동 API는 사용자별, 인증 API는 IP별
    rate_limit_per_min: int = int(os.environ.get("RATE_LIMIT_PER_MIN", "60"))
    rate_limit_auth_per_min: int = int(os.environ.get("RATE_LIMIT_AUTH_PER_MIN", "20"))


settings = Settings()
