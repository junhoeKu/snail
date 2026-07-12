FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

COPY pyproject.toml ./
RUN pip install fastapi 'uvicorn[standard]' sqlalchemy pydantic PyJWT httpx alembic psycopg2-binary

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./

EXPOSE 8080
# 배포 시 스키마 마이그레이션 후 기동 (실패하면 부팅을 막아 스키마 불일치 상태 방지)
CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
