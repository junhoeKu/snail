FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

COPY pyproject.toml ./
RUN pip install fastapi 'uvicorn[standard]' sqlalchemy pydantic PyJWT httpx alembic psycopg2-binary

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
