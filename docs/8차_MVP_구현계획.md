# 8차 MVP 구현 계획 — 계정 · 서버 저장 · 서버 권위형 게임

> 작성일: 2026-07-12
> 선행 조건: 7차 MVP 완료 (v0.9.0, 클라이언트 schema v6)
> 목표 기간: **5~7주** (역대 최대 — 아키텍처 전환)
> 검증 가설: **"기기를 바꾸거나 재설치해도 안전하게 이어서 플레이할 수 있고, 핵심 게임 판정을 서버가 신뢰성 있게 처리할 수 있는가?"**
> ⚠️ 원래 8차로 기획했던 "살아있는 생태계"는 [9차_MVP_구현계획.md](9차_MVP_구현계획.md)로 이월.

---

## 1. 목표

8차는 새로운 콘텐츠를 추가하는 단계가 아니다. **현재 LocalStorage 게임을 서버 저장형 서비스로 전환**한다.

1. 게스트 또는 소셜 계정으로 사용자를 식별한다
2. 기존 LocalStorage 데이터를 서버로 안전하게 이전한다
3. 코인·먹이·성장·탐험·보상을 서버에서 판정한다
4. 기존 프론트의 애니메이션과 PWA 경험을 최대한 유지한다

### 1.1 스택 제약 공식 개정 (중요)

지금까지 CLAUDE.md의 "서버/계정 금지" 원칙은 1~7차 MVP 검증을 위한 것이었다. 8차에서 이를 공식 개정한다:

- **프론트**: Vanilla HTML/CSS/JS + 빌드 없음 원칙 **유지** (번들러/프레임워크 여전히 금지). 통신은 `fetch` 기반 API 어댑터 모듈 1개 추가
- **백엔드**: 신규 영역 — §3의 스택을 표준으로 채택
- CLAUDE.md는 8차 1단계에서 함께 개정한다 (백엔드 규칙 섹션 추가)

---

## 2. 포함 범위

### 2.1 필수 기능

| # | 기능 | 내용 |
|---|------|------|
| 1 | 게스트 계정 | 최초 실행 시 서버에서 익명 계정 생성, 기기에 토큰 저장 |
| 2 | 소셜 계정 연결 | **Google 우선 1개** 연동(§5.2 참고), 게스트 데이터를 유지한 채 계정 연결 |
| 3 | 서버 저장 | 사용자·달팽이·인벤토리·앨범·일지·미션·탐험 상태 저장 |
| 4 | 기존 데이터 이전 | LocalStorage schema v6 데이터를 서버 계정으로 1회 마이그레이션 |
| 5 | 서버 권위형 행동 | 먹이·쓰다듬기·여행·구매·탐험·미션 보상·부화 판정을 서버에서 수행 |
| 6 | 서버 시간 기준 | 감쇠·일일 초기화·쿨다운·접속 보상을 서버 시각으로 판정 |
| 7 | API 오류 UX | 네트워크 오류·인증 만료·충돌 시 재시도 또는 안전한 안내 |
| 8 | 기본 배포 | 개발·스테이징·운영 분리, HTTPS API 배포 |

### 2.2 제외 범위

친구 방문·랭킹·길드 / 실제 결제 / 푸시 알림 / **완전한 오프라인 행동 동기화**(오프라인 시 관람만 가능, 행동은 연결 필요 안내) / 운영자 어드민 UI / 시즌 이벤트 / Kubernetes·마이크로서비스

---

## 3. 기술 스택

### 3.1 백엔드

Python 3.12 · FastAPI · SQLAlchemy 2.x · Pydantic 2.x · Alembic · PostgreSQL · Redis(세션 폐기·rate limit·idempotency 캐시) · Pytest · Docker

### 3.2 호스팅 (결정 필요 — 제안)

| 구성 | 제안 | 비고 |
|------|------|------|
| API | Fly.io 또는 Railway (Docker 배포) | 스테이징/운영 앱 2개 |
| PostgreSQL | Neon 또는 호스팅 내장 Postgres | 무료~소액 티어로 시작 |
| Redis | Upstash | 무료 티어, 미들웨어라 교체 쉬움 |
| 프론트 | **GitHub Pages 유지** | API는 CORS로 허용 (§6.4) |

> 상시 가동 비용이 발생하는 첫 단계다 — 프로바이더/요금제는 1단계 착수 전 사용자 확정 필요.

### 3.3 프로젝트 구조 (모노레포)

```
snail/
├── (기존 프론트: index.html, js/, css/, assets/ …)
├── js/api.js            ← 신규: API 어댑터 (fetch·토큰·재시도·오류 UX)
└── backend/
    ├── app/
    │   ├── main.py
    │   ├── core/        (config · security · database · redis · errors)
    │   ├── modules/     (auth · users · snails · inventory · game ·
    │   │                 exploration · missions · collection · migration)
    │   ├── shared/      (enums · events · idempotency)
    │   └── tests/
    ├── alembic/
    ├── Dockerfile
    ├── pyproject.toml
    └── docker-compose.yml
```

계층 규칙 (라우터에서 게임 수치를 직접 계산하지 않는다):

```
router → application service → domain rule → repository → PostgreSQL
```

- **domain rule은 현재 `js/game.js`의 순수 함수를 파이썬으로 이식**한 것 — 수치(FOOD_DEFS, 확률표, XP 곡선)는 단일 소스로 관리하고 클라 표시용 사본과 어긋나지 않게 `GET /v1/game/config`로 서버가 내려준다

---

## 4. 데이터 모델

### 4.1 사용자

```
users
- id UUID PK
- auth_type VARCHAR            -- guest | social
- provider VARCHAR NULL        -- google | apple
- provider_user_id VARCHAR NULL
- nickname VARCHAR NULL
- timezone VARCHAR DEFAULT 'Asia/Seoul'
- keeper_level INTEGER, keeper_xp INTEGER
- coins INTEGER
- generation INTEGER, snail_slots INTEGER
- sound_on BOOLEAN
- selected_food VARCHAR        -- (v6 필드 누락 보완)
- streak_count INTEGER, streak_last_date DATE      -- (v6 스트릭 보완)
- last_daily_reward DATE
- created_at / updated_at / deleted_at TIMESTAMPTZ
```

### 4.2 달팽이

```
snails
- id UUID PK, user_id UUID FK
- name VARCHAR, stage VARCHAR, level INTEGER, exp INTEGER
- hunger NUMERIC, happiness NUMERIC
- color VARCHAR, personality VARCHAR, wild_variant VARCHAR NULL
- pos_x NUMERIC, pos_y NUMERIC
- hatched_at TIMESTAMPTZ NULL
- last_state_at TIMESTAMPTZ    -- 감쇠 lazy 계산 기준
- version INTEGER DEFAULT 1    -- 낙관적 잠금
- graduated_at TIMESTAMPTZ NULL
- created_at / updated_at
```

### 4.3 인벤토리 (먹이·장식·향후 재화 공용)

```
items:        id VARCHAR PK, item_type, name, metadata JSONB
inventories:  PK(user_id, item_id), quantity INTEGER, updated_at
```

### 4.4 계정 단위 데이터

`album_entries` · `journal_entries` · `mission_progress` · `exploration_states` · `decoration_slots` · `discovered_variants`(조회 빈도가 높아 앨범 파생 대신 별도 저장) · `unlocked_maps`

### 4.5 행동·경제 이력

```
game_actions:    id, user_id, action_type, target_id, request_id(멱등키),
                 payload JSONB, result JSONB, created_at
currency_ledger: id, user_id, currency, amount, balance_after,
                 reason, reference_id, created_at
```

- `request_id`로 중복 요청 멱등 처리 (Redis 캐시 + game_actions 유니크)
- `currency_ledger`는 코인 중복 지급·차감 오류 추적/복구용 원장

---

## 5. 인증 설계

### 5.1 게스트

`POST /v1/auth/guest` → users 레코드 생성 → access + refresh 토큰 반환. 게스트도 정상 계정이다.

### 5.2 소셜 연결

`POST /v1/auth/link/google` (Apple은 후순위 — 웹 Sign in with Apple은 유료 개발자 계정·도메인 검증이 필요해 2차로 미룬다)

- 게스트 계정을 삭제하고 갈아타지 않는다 — **인증 수단만 연결**, 달팽이·인벤토리·앨범 유지
- 이미 다른 계정에 연결된 소셜 ID면 자동 병합하지 않고 **충돌 화면** 표시

### 5.3 토큰

- Access 짧은 만료 / Refresh 회전 방식, 서버 세션 테이블에 저장(폐기 가능)
- GitHub Pages(정적 크로스 도메인) 특성상 HttpOnly 쿠키가 어려우면 저장소 보관 + CSP·입력 검증 강화로 완화

---

## 6. 서버 권위형 게임 규칙

### 6.1 원칙 — 클라이언트는 "행동"만 요청한다

```
POST /v1/snails/{id}/feed · /pet · /graduate · /hatch
POST /v1/explorations/search
POST /v1/shop/purchase
```

클라이언트가 직접 보내지 않는 것: 경험치 증가량, 코인 증가량, 탐험 당첨 결과, 부화 변이, 미션 완료 여부, 레벨업 후 레벨.

### 6.2 응답 형식 — 기존 프론트 events 구조 유지

```json
{
  "revision": 104,
  "serverTime": "2026-07-12T03:00:00Z",
  "changes": { "snails": [], "player": {}, "inventory": {} },
  "events": [
    { "type": "fed", "snailId": "..." },
    { "type": "keeper_xp_gained", "amount": 2 }
  ]
}
```

프론트는 `events`로 기존 효과음·토스트·컨페티를 그대로 실행한다 — **연출 파이프라인 무변경**이 전환 리스크를 줄이는 핵심.

### 6.3 시간 감쇠 — 배치 없음, lazy 계산

상태 조회/행동 직전에 `now - last_state_at`으로 경과분을 계산·반영 (현재 클라이언트의 `last_seen` 방식과 동일 철학이라 이식 위험이 낮다). 장식 패시브·잠꾸러기 규칙도 서버 계산에 포함.

### 6.4 클라이언트 전환 시 주의 (코드베이스 대조 결과)

- **sw.js 캐시 충돌**: 현재 서비스 워커는 cache-first로 모든 GET을 캐시한다 — **`/v1/*` API 요청은 캐시 제외(network-only)** 로 수정 필수. 안 하면 낡은 게임 상태가 응답된다
- **CORS**: API가 `https://junhoeku.github.io` origin 허용 + 인증 헤더 허용
- **관리자 모드**: `?admin=1` 클라 치트는 서버 판정으로 자동 무력화 — 서버측 dev 플래그(스테이징 한정)로 대체
- **백업 코드 기능**: 서버 저장 후 역할 축소 — 마이그레이션 완료 계정에선 숨기고, 비상 수단으로만 유지 여부 QA에서 결정
- **클라 game.js의 역할 재정의**: 판정 로직은 서버로 이식되고, 클라는 연출·모션·표시 전용으로 축소 (모션/성격/생태계 연출은 계속 클라 소관 — 9차와의 경계)
- **위치 저장**: 경제 데이터가 아니므로 `POST /v1/game/sync-position`으로 주기(예: 60초)/탭 이탈 시 마지막 좌표만 저장

---

## 7. LocalStorage 데이터 이전

### 7.1 흐름

```
1. 앱 업데이트 후 게스트 계정 생성
2. 서버 저장 데이터 존재 여부 조회
3. 서버가 비어 있고 Local v6 데이터가 있으면 이전 제안 (사용자 확인)
4. 원본 JSON + schema_version 전송 → 서버 검증·정규화
5. 단일 DB 트랜잭션으로 저장 → 완료 토큰 반환
6. LocalStorage는 캐시 용도로 보존 + migration_done 표시
```

### 7.2 API — `POST /v1/migrations/local-v6`

요청: `{ schemaVersion: 6, player, snails, album, journal }`

### 7.3 검증 규칙

- 달팽이 수 ≤ **서버 설정 MAX_SNAILS** (현재 3 — 하드코딩 금지, 9차에서 8로 오르므로 config화)
- 코인·아이템 수량 음수 금지, 비정상 거대값은 격리 + 운영 로그
- 허용된 stage·color·personality·food id만 통과, 미지의 필드는 무시(원본은 payload 보관)
- **동일 계정에서 마이그레이션은 1회만 성공** (멱등)
- 관리자 모드 흔적(코인 999999 등)은 상한 클램프 규칙 명시

---

## 8. API 초안

```
POST   /v1/auth/guest          POST   /v1/auth/refresh
POST   /v1/auth/link/google

GET    /v1/game/state          GET    /v1/game/config
POST   /v1/game/sync-position

POST   /v1/snails/{id}/hatch   POST   /v1/snails/{id}/feed
POST   /v1/snails/{id}/pet     POST   /v1/snails/{id}/graduate
PATCH  /v1/snails/{id}/name

POST   /v1/shop/purchase       POST   /v1/explorations/search

GET    /v1/album  /v1/journal  /v1/collection  /v1/missions

POST   /v1/migrations/local-v6
```

---

## 9. 구현 단계

| 단계 | 브랜치 | 내용 | 완료 기준 |
|------|--------|------|-----------|
| 1 | `infra/backend-bootstrap` | FastAPI·PostgreSQL·Redis·Docker·환경 설정 + CLAUDE.md 개정 | 로컬/테스트 환경 부팅 |
| 2 | `feat/server-schema` | Alembic 초기 스키마 + Repository | 기본 CRUD 테스트 통과 |
| 3 | `feat/server-auth` | 게스트 인증·토큰 재발급·세션 | 앱 재실행 후 동일 계정 유지 |
| 4 | `feat/local-migration` | v6 검증·이전 API | 기존 데이터 무손실 이전 |
| 5 | `feat/server-game-core` | 먹이·성장·구매·탐험·여행 서버 판정 (game.js 이식 + 단위 테스트) | 핵심 행동 API 통과 |
| 6 | `feat/client-api-adapter` | js/api.js + Local 저장 → API 호출 교체 + sw.js API 제외 | 기존 UI·연출 유지 |
| 7 | `feat/server-time` | 감쇠·미션·일일 초기화 서버 시각화 + 소셜 연결(Google) | 클라 시각 조작 무효 |
| 8 | `chore/v8-qa` | 통합·E2E·마이그레이션·스테이징/운영 배포 QA | §11 전체 통과 |

---

## 10. 테스트

### 10.1 단위 (도메인 이식 검증 — 기존 jsdom 테스트 수치와 교차 대조)

경험치/레벨업 · 성장 단계 전환 · 먹이별 효과 · 장식 패시브 · 변이 확률(세대/맵 보정) · 탐험 확률 · 시간 감쇠 · 양육자 XP 곡선 · 스트릭

### 10.2 통합

먹이 차감+스탯+양육자 XP 단일 트랜잭션 / 여행+앨범+새 알 / 탐험 스태미나+보상 / 게스트 생성·재발급 / 마이그레이션 왕복

### 10.3 필수 불변식

코인 음수 불가 · 인벤토리 음수 불가 · 달팽이는 한 사용자 소유 · 졸업한 달팽이는 행동 불가 · 하루 탐험 상한 초과 불가 · 동일 마이그레이션 2회 적용 불가

---

## 11. 완료 조건

1. 최초 접속 시 게스트 계정이 자동 생성된다
2. 재접속·재설치 후 로그인하면 같은 데이터를 복원한다
3. 기존 LocalStorage v6 데이터가 서버로 무손실 이전된다
4. 먹이·구매·탐험·부화·여행 결과를 서버가 판정한다
5. 클라이언트 시간을 변경해도 감쇠·미션·탐험 초기화가 조작되지 않는다
6. 핵심 행동이 트랜잭션 처리되어 일부만 저장되는 상태가 없다
7. 기존 달팽이 움직임·효과음·컨페티·PWA UI가 유지된다
8. 스테이징과 운영 환경이 분리된다
9. 핵심 API 통합 테스트와 E2E 테스트가 통과한다
10. 장애 시 행동 이력(game_actions)과 코인 원장(currency_ledger)을 조회할 수 있다

---

## 12. 착수 전 확정 필요 (사용자 결정)

1. **호스팅/요금**: §3.2 제안(Fly.io/Railway + Neon + Upstash) 승인 여부 — 첫 상시 비용 발생 지점
2. **Google OAuth**: Google Cloud 프로젝트/클라이언트 ID 발급 (사용자 계정 필요)
3. API 도메인 (기본: 호스팅 제공 서브도메인)
4. 9차(생태계)는 서버 전환 완료 후 진행 — 슬롯 8마리 확장도 그때 서버 config로 함께
