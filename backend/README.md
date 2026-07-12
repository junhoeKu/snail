# Snail Backend — 서버 권위형 API

FastAPI + SQLAlchemy + PostgreSQL. 게임 판정(먹이/성장/구매/탐험/여행/보상)의 단일 소스는
`app/domain/rules.py`이며, 클라이언트 `js/game.js`의 수치와 항상 일치해야 한다
(표시용 수치는 `GET /v1/game/config`).

## 로컬 실행

```bash
# 1) 가상환경 + 의존성
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'

# 2-a) 빠른 실행 (SQLite — 테이블 자동 생성)
.venv/bin/uvicorn app.main:app --reload --port 8000

# 2-b) 실제 구성 (PostgreSQL + Redis)
docker compose up --build
```

- API 문서: http://localhost:8000/docs
- 테스트: `.venv/bin/pytest`

## 프론트 연결

`index.html`의 `window.SNAIL_API_BASE`에 API 주소를 넣으면 서버 모드로 동작한다.
비워두면 기존 LocalStorage 로컬 모드로 동작한다 (듀얼 모드).

## 운영 배포 (Fly.io / Railway / Render 등)

1. `.env.example`을 참고해 환경변수 설정 (JWT_SECRET은 `openssl rand -hex 32`)
2. Dockerfile로 배포, `DATABASE_URL`은 관리형 PostgreSQL(Neon 등)
3. 스키마: Docker 컨테이너가 기동 시 `alembic upgrade head`를 먼저 실행한다(Dockerfile CMD).
   - 신규 테이블은 startup의 `create_all`도 보강하지만, **기존 테이블 컬럼 추가는 Alembic만 처리**한다.
   - 마이그레이션은 방어적(존재 검사)이라 8차 운영 DB·신규 DB 모두에서 idempotent하다.
   - 모델 변경 시 새 마이그레이션 추가:
     ```bash
     DATABASE_URL=... alembic revision --autogenerate -m "설명"   # 초안 생성
     DATABASE_URL=... alembic upgrade head                         # 적용
     ```
4. `CORS_ORIGINS`에 프론트 도메인(`https://junhoeku.github.io`) 지정
5. Rate Limit 임계값(선택): `RATE_LIMIT_PER_MIN`(기본 60), `RATE_LIMIT_AUTH_PER_MIN`(기본 20)
6. 스테이징/운영은 별도 앱 + 별도 DB로 분리

## 계층 규칙

```
router → application service → domain rule(rules.py) → repository(SQLAlchemy) → PostgreSQL
```

- 라우터에서 게임 수치를 직접 계산하지 않는다
- 코인 증감은 반드시 `service.add_coins`(원장 기록)를 거친다
- 행동 API는 `request_id` 멱등키를 받는다 (중복 요청 = 저장된 결과 반환)
- Redis는 선택 구성(세션 폐기 캐시/레이트리밋용) — v1은 DB만으로 동작
