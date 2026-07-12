# 8~10차 MVP 구현 계획 — 서버 저장형 게임 전환과 운영 기반 완성

> 작성일: 2026-07-12  
> 선행 조건: 7차 MVP 완료 (`schema_version: 6`, 멀티 달팽이·탐험·PWA·백업·양육자 레벨 구현)  
> 전체 목표 기간: 약 12~18주  
> 최종 목표: **LocalStorage 중심 PWA를 계정·서버 저장·오프라인 동기화·라이브 운영이 가능한 서비스형 게임으로 전환한다.**

---

## 0. 전체 방향

### 0.1 현재 상태

7차까지의 게임은 다음 기능을 갖춘다.

- 최대 3마리 달팽이 동시 사육
- 먹이·성장·양육자 레벨·미션
- 성격·컨디션·날씨·복귀 리포트
- 탐험 채집·야생 알·변이·세대 교체
- 도감·앨범·일지·장식 효과
- PWA 설치·오프라인 실행
- LocalStorage 저장 및 수동 백업/복원

현재 구조의 가장 큰 한계는 게임 데이터와 판정이 사용자 기기에 있다는 점이다.

```text
현재
클라이언트 GAME 함수
    ↓
LocalStorage 저장
    ↓
기기별 독립 데이터
```

이 구조에서는 다음 문제가 남는다.

1. 기기 변경 시 자동 복구가 불가능하다.
2. LocalStorage 삭제 시 데이터가 사라질 수 있다.
3. 클라이언트 조작으로 코인·경험치·탐험 결과를 변경할 수 있다.
4. 친구·랭킹·결제·시즌 이벤트를 안전하게 추가하기 어렵다.
5. 장애 발생 시 운영자가 사용자의 상태를 확인하거나 복구하기 어렵다.
6. 밸런스 변경을 위해 매번 프론트엔드를 다시 배포해야 한다.

### 0.2 8~10차 재구성

기존에 제안한 8~15차 내용을 다음 세 단계로 통합한다.

| 차수 | 핵심 목표 | 통합되는 기존 제안 |
|---|---|---|
| **8차** | 계정·서버 저장·핵심 행동 서버 권위화 | 계정/DB, 서버 권위형 로직, 시간 시스템 일부 |
| **9차** | 오프라인 동기화·트랜잭션·보안·운영 안정성 | 오프라인 동기화, 동시성, 원장, 관측성, 백업 |
| **10차** | 어드민·라이브 운영·CI/CD·확장 준비 | 어드민, 원격 설정, 이벤트, 배포, 무중단 운영 |

### 0.3 최종 아키텍처

```text
┌────────────────────────────────────┐
│ PWA / Web Client                   │
│ UI · 애니메이션 · 로컬 스냅샷       │
│ IndexedDB · Offline Action Queue   │
└─────────────────┬──────────────────┘
                  │ HTTPS REST API
                  ▼
┌────────────────────────────────────┐
│ FastAPI Modular Monolith           │
│ Auth / Game / Inventory / Explore  │
│ Mission / Collection / Admin       │
└───────┬────────────┬───────────────┘
        │            │
        ▼            ▼
 PostgreSQL        Redis
 영속 데이터       캐시·락·Rate Limit
        │
        ▼
 Background Worker
 알림·이벤트·통계·정리 작업
        │
        ▼
 S3-compatible Object Storage
 공유 카드·백업·운영 파일
```

초기에는 마이크로서비스를 사용하지 않는다. 하나의 FastAPI 애플리케이션 안에서 도메인별 모듈을 분리하는 **모듈형 모놀리스**로 구현한다.

---

# 8차 MVP — 계정·서버 저장·서버 권위형 게임

> 목표 기간: 5~7주  
> 검증 가설: **“사용자가 기기를 바꾸거나 앱을 재설치해도 안전하게 이어서 플레이할 수 있고, 핵심 게임 판정을 서버가 신뢰성 있게 처리할 수 있는가?”**

---

## 1. 목표

8차는 새로운 콘텐츠를 추가하는 단계가 아니다. 현재 LocalStorage 게임을 **서버 저장형 서비스**로 전환한다.

핵심 목표는 다음 네 가지다.

1. 게스트 또는 소셜 계정으로 사용자를 식별한다.
2. 기존 LocalStorage 데이터를 서버로 안전하게 이전한다.
3. 코인·먹이·성장·탐험·보상을 서버에서 판정한다.
4. 기존 프론트의 애니메이션과 PWA 경험을 최대한 유지한다.

---

## 2. 포함 범위

### 2.1 필수 기능

| # | 기능 | 내용 |
|---|---|---|
| 1 | 게스트 계정 | 최초 실행 시 서버에서 익명 계정을 생성하고 기기에 토큰 저장 |
| 2 | 소셜 계정 연결 | Google·Apple 중 최소 1개 연동, 게스트 데이터를 유지한 채 계정 연결 |
| 3 | 서버 저장 | 사용자·달팽이·인벤토리·앨범·일지·미션·탐험 상태 저장 |
| 4 | 기존 데이터 이전 | LocalStorage schema v6 데이터를 서버 계정으로 1회 마이그레이션 |
| 5 | 서버 권위형 행동 | 먹이, 쓰다듬기, 여행, 구매, 탐험, 미션 보상, 부화 판정을 서버에서 수행 |
| 6 | 서버 시간 기준 | 감쇠·일일 초기화·쿨다운·접속 보상을 서버 시각으로 판정 |
| 7 | API 오류 UX | 네트워크 오류·인증 만료·충돌 시 재시도 또는 안전한 안내 |
| 8 | 기본 배포 | 개발·스테이징·운영 환경 분리 및 HTTPS API 배포 |

### 2.2 제외 범위

- 친구 방문·랭킹·길드
- 실제 결제
- 푸시 알림
- 완전한 오프라인 행동 동기화
- 운영자 어드민
- 시즌 이벤트
- Kubernetes 또는 마이크로서비스

---

## 3. 기술 스택

### 3.1 백엔드

```text
Python 3.12
FastAPI
SQLAlchemy 2.x
Pydantic 2.x
Alembic
PostgreSQL
Redis
Pytest
Docker
```

### 3.2 권장 프로젝트 구조

```text
backend/
├── app/
│   ├── main.py
│   ├── core/
│   │   ├── config.py
│   │   ├── security.py
│   │   ├── database.py
│   │   ├── redis.py
│   │   └── errors.py
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── snails/
│   │   ├── inventory/
│   │   ├── game/
│   │   ├── exploration/
│   │   ├── missions/
│   │   ├── collection/
│   │   └── migration/
│   ├── shared/
│   │   ├── enums.py
│   │   ├── events.py
│   │   └── idempotency.py
│   └── tests/
├── alembic/
├── Dockerfile
├── pyproject.toml
└── docker-compose.yml
```

도메인 모듈은 다음 계층을 유지한다.

```text
router
  ↓
application service
  ↓
domain rule
  ↓
repository
  ↓
PostgreSQL
```

라우터에서 게임 수치를 직접 계산하지 않는다.

---

## 4. 데이터 모델

### 4.1 사용자

```sql
users
- id UUID PK
- auth_type VARCHAR
- provider VARCHAR NULL
- provider_user_id VARCHAR NULL
- nickname VARCHAR NULL
- timezone VARCHAR DEFAULT 'Asia/Seoul'
- keeper_level INTEGER
- keeper_xp INTEGER
- coins INTEGER
- generation INTEGER
- snail_slots INTEGER
- sound_on BOOLEAN
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ
- deleted_at TIMESTAMPTZ NULL
```

### 4.2 달팽이

```sql
snails
- id UUID PK
- user_id UUID FK
- name VARCHAR
- stage VARCHAR
- level INTEGER
- exp INTEGER
- hunger NUMERIC
- happiness NUMERIC
- color VARCHAR
- personality VARCHAR
- pos_x NUMERIC
- pos_y NUMERIC
- hatched_at TIMESTAMPTZ NULL
- last_state_at TIMESTAMPTZ
- version INTEGER DEFAULT 1
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ
- graduated_at TIMESTAMPTZ NULL
```

`version`은 동시 수정 충돌을 확인하기 위한 낙관적 잠금 값이다.

### 4.3 인벤토리

```sql
items
- id VARCHAR PK
- item_type VARCHAR
- name VARCHAR
- metadata JSONB

inventories
- user_id UUID FK
- item_id VARCHAR FK
- quantity INTEGER
- updated_at TIMESTAMPTZ
PK (user_id, item_id)
```

먹이·장식·향후 재화를 같은 구조에서 관리한다.

### 4.4 계정 단위 데이터

```sql
album_entries
journal_entries
mission_progress
exploration_states
owned_decorations
decoration_slots
discovered_variants
```

도감은 앨범에서 매번 계산할 수도 있지만, 조회 빈도가 높아지므로 `discovered_variants`에 발견 사실을 별도로 저장한다.

### 4.5 행동·경제 이력

```sql
game_actions
- id UUID PK
- user_id UUID
- action_type VARCHAR
- target_id UUID NULL
- request_id VARCHAR
- payload JSONB
- result JSONB
- created_at TIMESTAMPTZ

currency_ledger
- id UUID PK
- user_id UUID
- currency VARCHAR
- amount INTEGER
- balance_after INTEGER
- reason VARCHAR
- reference_id UUID NULL
- created_at TIMESTAMPTZ
```

`currency_ledger`는 코인 중복 지급·차감 오류를 추적하고 복구하기 위한 원장이다.

---

## 5. 인증 설계

### 5.1 게스트 계정

최초 실행:

```text
클라이언트
→ POST /v1/auth/guest
→ user 생성
→ access token + refresh token 반환
```

게스트 계정도 서버에 정상적인 `users` 레코드를 가진다.

### 5.2 소셜 연결

```http
POST /v1/auth/link/google
POST /v1/auth/link/apple
```

원칙:

- 기존 게스트 계정을 삭제하고 새 계정으로 갈아타지 않는다.
- 게스트의 달팽이·인벤토리·앨범을 유지한 채 인증 수단만 연결한다.
- 이미 다른 계정에 연결된 소셜 ID라면 병합을 자동 실행하지 않고 충돌 화면을 표시한다.

### 5.3 토큰

- Access Token: 짧은 만료
- Refresh Token: 회전 방식
- Refresh Token은 서버에서 폐기 가능하도록 세션 테이블에 저장
- 웹에서는 가능한 경우 HttpOnly Secure Cookie 사용
- PWA 제약상 저장소 사용이 필요하면 토큰 탈취 위험을 줄이도록 CSP와 입력 검증 강화

---

## 6. 서버 권위형 게임 규칙

### 6.1 원칙

클라이언트는 행동만 요청한다.

```http
POST /v1/snails/{snail_id}/feed
POST /v1/snails/{snail_id}/pet
POST /v1/snails/{snail_id}/graduate
POST /v1/explorations/search
POST /v1/shop/purchase
POST /v1/snails/{snail_id}/hatch
```

클라이언트가 아래 값을 직접 보내지 않는다.

```text
증가할 경험치
증가할 코인
탐험 당첨 결과
부화 변이
미션 완료 여부
레벨업 후 레벨
```

### 6.2 응답 형식

기존 프론트의 `events` 구조를 유지한다.

```json
{
  "revision": 104,
  "serverTime": "2026-07-12T03:00:00Z",
  "changes": {
    "snails": [],
    "player": {},
    "inventory": {}
  },
  "events": [
    {
      "type": "fed",
      "snailId": "..."
    },
    {
      "type": "keeper_xp_gained",
      "amount": 2
    }
  ]
}
```

프론트는 `events`를 받아 기존 효과음·토스트·컨페티를 실행한다.

### 6.3 시간 감쇠

달팽이 상태를 매시간 갱신하는 배치 작업은 만들지 않는다.

상태 조회나 행동 직전에 서버가 경과 시간을 계산한다.

```python
elapsed = now - snail.last_state_at
hunger = min(100, snail.hunger + decay_rate * elapsed_hours)
happiness = max(0, snail.happiness - decay_rate * elapsed_hours)
```

계산 후 행동이 발생하면 최신 값을 저장하고 `last_state_at`을 갱신한다.

---

## 7. LocalStorage 데이터 이전

### 7.1 마이그레이션 흐름

```text
1. 앱 업데이트 후 서버 계정 생성
2. 서버에 저장 데이터 존재 여부 조회
3. 서버 데이터가 비어 있고 LocalStorage v6 데이터가 있으면 이전 제안
4. 클라이언트가 원본 JSON과 schema_version 전송
5. 서버가 검증·정규화
6. 하나의 DB 트랜잭션으로 저장
7. 마이그레이션 완료 토큰 반환
8. LocalStorage는 캐시 용도로 보존하되 migration_done 표시
```

### 7.2 API

```http
POST /v1/migrations/local-v6
```

요청에는 다음 데이터가 포함된다.

```json
{
  "schemaVersion": 6,
  "player": {},
  "snails": [],
  "album": [],
  "journal": []
}
```

### 7.3 검증 규칙

- 달팽이 최대 3마리
- 코인·아이템 수량 음수 금지
- 허용된 stage·color·personality만 통과
- 알 수 없는 필드는 무시하거나 별도 보관
- 비정상적으로 큰 값은 격리하고 운영 로그 기록
- 동일 계정에서 마이그레이션 API는 한 번만 성공 가능

---

## 8. API 초안

```text
POST   /v1/auth/guest
POST   /v1/auth/refresh
POST   /v1/auth/link/google

GET    /v1/game/state
POST   /v1/game/sync-position

POST   /v1/snails/{id}/hatch
POST   /v1/snails/{id}/feed
POST   /v1/snails/{id}/pet
POST   /v1/snails/{id}/graduate
PATCH  /v1/snails/{id}/name

POST   /v1/shop/purchase
POST   /v1/explorations/search

GET    /v1/album
GET    /v1/journal
GET    /v1/collection
GET    /v1/missions

POST   /v1/migrations/local-v6
```

달팽이 위치는 경제 데이터가 아니므로 빈번한 이동마다 저장하지 않는다. 일정 주기 또는 앱 종료 시 마지막 좌표만 저장한다.

---

## 9. 구현 단계

| 단계 | 브랜치 | 내용 | 완료 기준 |
|---|---|---|---|
| 1 | `infra/backend-bootstrap` | FastAPI·PostgreSQL·Redis·Docker·환경 설정 | 로컬/테스트 환경 부팅 |
| 2 | `feat/server-schema` | Alembic 초기 스키마·Repository | 기본 CRUD 테스트 통과 |
| 3 | `feat/server-auth` | 게스트 인증·토큰 재발급·세션 | 앱 재실행 후 동일 계정 유지 |
| 4 | `feat/local-migration` | LocalStorage v6 검증·이전 API | 기존 데이터 무손실 이전 |
| 5 | `feat/server-game-core` | 먹이·성장·구매·탐험·여행 서버 판정 | 핵심 행동 API 통과 |
| 6 | `feat/client-api-adapter` | Local GAME 직접 저장을 API 호출 방식으로 교체 | 기존 UI·연출 유지 |
| 7 | `feat/server-time` | 감쇠·미션·일일 초기화 서버 시각화 | 클라이언트 시각 조작 무효 |
| 8 | `chore/v8-qa` | 통합·E2E·마이그레이션·배포 QA | 완료 조건 전체 통과 |

---

## 10. 테스트

### 10.1 단위 테스트

- 경험치와 레벨업
- 성장 단계 전환
- 먹이별 효과
- 장식 패시브
- 변이 확률
- 탐험 확률
- 시간 감쇠
- 양육자 레벨 곡선

### 10.2 통합 테스트

- 먹이 차감 + 달팽이 스탯 + 양육자 XP가 한 트랜잭션으로 처리
- 여행 처리 + 앨범 기록 + 새 알 생성
- 탐험 스태미나 차감 + 보상 지급
- 게스트 계정 생성·재발급
- LocalStorage 데이터 이전

### 10.3 필수 불변식

```text
코인은 음수가 될 수 없다.
인벤토리 수량은 음수가 될 수 없다.
달팽이는 하나의 사용자에게만 속한다.
졸업한 달팽이는 다시 행동할 수 없다.
하루 탐험 횟수는 상한을 넘을 수 없다.
동일 마이그레이션은 두 번 적용되지 않는다.
```

---

## 11. 완료 조건

1. 최초 접속 시 게스트 계정이 자동 생성된다.
2. 재접속·재설치 후 로그인하면 같은 데이터를 복원한다.
3. 기존 LocalStorage v6 데이터가 서버로 무손실 이전된다.
4. 먹이·구매·탐험·부화·여행 결과를 서버가 판정한다.
5. 클라이언트 시간을 변경해도 감쇠·미션·탐험 초기화가 조작되지 않는다.
6. 핵심 행동이 트랜잭션으로 처리되어 일부 데이터만 저장되는 상태가 없다.
7. 기존 달팽이 움직임·효과음·컨페티·PWA UI가 유지된다.
8. 스테이징과 운영 환경이 분리된다.
9. 핵심 API 통합 테스트와 E2E 테스트가 통과한다.
10. 장애 시 사용자의 행동 이력과 코인 원장을 조회할 수 있다.

---

# 9차 MVP — 오프라인 동기화·동시성·보안·운영 안정성

> 목표 기간: 4~6주  
> 선행 조건: 8차 서버 저장형 전환 완료  
> 검증 가설: **“네트워크가 불안정하거나 여러 기기에서 플레이해도 중복·유실 없이 안전하게 상태가 동기화되는가?”**

---

## 1. 목표

8차에서는 온라인 상태의 서버 저장을 완성한다. 9차에서는 PWA의 장점을 유지하기 위해 **오프라인 우선 동기화 구조**를 추가하고, 실제 운영에서 필요한 안정성을 확보한다.

핵심 목표:

1. 오프라인에서도 제한된 돌봄 행동을 수행한다.
2. 네트워크 복귀 후 행동을 중복 없이 서버에 반영한다.
3. 여러 기기의 동시 행동으로 재화가 복제되지 않게 한다.
4. 인증·Rate Limit·감사 로그·백업·관측성을 완성한다.
5. 장애가 발생해도 데이터 상태를 추적하고 복구할 수 있게 한다.

---

## 2. 포함 범위

| # | 기능 | 내용 |
|---|---|---|
| 1 | IndexedDB 로컬 저장 | 서버 스냅샷·대기 행동·동기화 메타데이터 저장 |
| 2 | 오프라인 액션 큐 | 허용된 행동을 로컬 큐에 기록 후 온라인 복귀 시 전송 |
| 3 | 멱등성 | 같은 행동이 여러 번 전송돼도 한 번만 반영 |
| 4 | Revision 동기화 | 서버 상태 버전으로 최신·충돌 여부 판단 |
| 5 | 동시성 제어 | DB Row Lock·낙관적 잠금·Redis Lock 적용 |
| 6 | 재화 원장 | 코인·아이템 변동 이력과 잔액 추적 |
| 7 | 보안 | Rate Limit·입력 검증·CORS·CSP·토큰 회전 |
| 8 | 관측성 | 구조화 로그·Sentry·메트릭·알림 |
| 9 | 백업/복구 | PostgreSQL 자동 백업과 복구 절차 |
| 10 | 부하·장애 테스트 | 동시 요청·네트워크 재시도·DB 장애 검증 |

---

## 3. 오프라인 저장 구조

LocalStorage는 단순 설정값에만 사용하고 게임 상태는 IndexedDB로 이동한다.

```text
IndexedDB
├── state_snapshot
│   ├── revision
│   ├── fetched_at
│   └── state
├── pending_actions
│   ├── action_id
│   ├── type
│   ├── payload
│   ├── base_revision
│   ├── client_created_at
│   └── retry_count
└── sync_meta
    ├── last_success_at
    ├── device_id
    └── schema_version
```

### 3.1 행동 형식

```json
{
  "actionId": "01J...ULID",
  "deviceId": "device-uuid",
  "type": "FEED_SNAIL",
  "payload": {
    "snailId": "...",
    "foodId": "lettuce"
  },
  "baseRevision": 104,
  "clientCreatedAt": "2026-07-12T12:30:00+09:00"
}
```

### 3.2 오프라인 허용 행동

| 행동 | 오프라인 허용 | 처리 |
|---|---|---|
| 먹이 주기 | 조건부 허용 | 로컬 예상 반영 후 서버에서 최종 검증 |
| 쓰다듬기 | 허용 | 중복·쿨다운 서버 검증 |
| 배경 변경 | 허용 | 최신 수정 시각 기준 |
| 달팽이 위치 | 허용 | 마지막 좌표만 병합 |
| 이름 변경 | 허용 | 금칙어·길이 서버 재검증 |
| 상점 구매 | 제한 | 온라인 권장, 재화 부족 충돌 가능 |
| 탐험 | 금지 | 보상 RNG가 서버 권위이므로 온라인만 |
| 부화 | 금지 | 변이·성격 추첨 서버 처리 |
| 여행 | 금지 | 앨범·세대·새 알을 원자적으로 처리 |
| 결제 | 금지 | 항상 온라인 |

---

## 4. 동기화 프로토콜

### 4.1 API

```http
POST /v1/sync/actions
GET  /v1/game/state?after_revision=104
```

### 4.2 일괄 전송 요청

```json
{
  "deviceId": "...",
  "knownRevision": 104,
  "actions": [
    {
      "actionId": "...",
      "type": "FEED_SNAIL",
      "payload": {}
    }
  ]
}
```

### 4.3 응답

```json
{
  "revision": 108,
  "accepted": ["action-1"],
  "rejected": [
    {
      "actionId": "action-2",
      "reason": "NOT_ENOUGH_FOOD"
    }
  ],
  "patch": {
    "player": {},
    "snails": [],
    "inventory": {}
  },
  "events": []
}
```

### 4.4 처리 순서

```text
1. 네트워크 감지
2. 토큰 갱신
3. pending_actions를 생성 순서대로 묶음 전송
4. 서버가 action_id 중복 여부 확인
5. 각 행동을 트랜잭션으로 처리
6. accepted/rejected와 최신 revision 반환
7. 클라이언트가 서버 patch 적용
8. 성공한 행동 큐에서 삭제
9. 거절된 optimistic UI 보정
```

---

## 5. 멱등성과 동시성

### 5.1 멱등성 테이블

```sql
idempotency_keys
- user_id UUID
- action_id VARCHAR
- request_hash VARCHAR
- response JSONB
- status VARCHAR
- expires_at TIMESTAMPTZ
PK (user_id, action_id)
```

동일 `action_id`가 다시 오면 기존 응답을 반환한다.

동일 ID인데 payload 해시가 다르면 보안 이벤트로 기록하고 거부한다.

### 5.2 비관적 잠금

먹이 소비·구매·탐험처럼 재화가 변하는 작업:

```sql
SELECT *
FROM inventories
WHERE user_id = :user_id
  AND item_id = :item_id
FOR UPDATE;
```

같은 트랜잭션 안에서 다음을 처리한다.

```text
재고 검증
→ 아이템 차감
→ 달팽이 상태 갱신
→ 미션 진행
→ 양육자 XP
→ 원장 기록
→ revision 증가
```

### 5.3 낙관적 잠금

달팽이 이름·좌표·장식 배치처럼 충돌 가능성이 낮은 데이터:

```sql
UPDATE snails
SET name = :name,
    version = version + 1
WHERE id = :id
  AND version = :expected_version;
```

영향 행이 없으면 `409 CONFLICT`와 최신 상태를 반환한다.

### 5.4 Redis 사용 범위

- 인증·API Rate Limit
- 짧은 분산 락
- 자주 조회되는 게임 설정 캐시
- 중복 이벤트 방지
- 백그라운드 작업 큐

PostgreSQL 데이터의 진실 원천을 Redis로 옮기지 않는다.

---

## 6. 재화·아이템 원장

코인과 프리미엄 재화는 반드시 원장으로 관리한다.

```sql
currency_ledger
inventory_ledger
```

예시:

```json
{
  "userId": "...",
  "amount": -10,
  "balanceAfter": 120,
  "reason": "SHOP_PURCHASE",
  "referenceId": "purchase-id"
}
```

원장 규칙:

1. 원장과 실제 잔액 변경은 같은 트랜잭션에서 수행한다.
2. 원장 레코드는 수정하지 않고 보정 레코드를 추가한다.
3. 모든 지급·차감은 `reason`과 `reference_id`를 가진다.
4. 운영자 보상도 관리자 계정과 사유를 기록한다.
5. 비정상 잔액은 원장 합계와 비교해 탐지한다.

---

## 7. 보안

### 7.1 API 보안

- 모든 통신 HTTPS
- 사용자별·IP별 Rate Limit
- 요청 body 크기 제한
- 달팽이 이름 길이·문자 검증
- 인증 실패 횟수 제한
- CORS 허용 도메인 최소화
- CSP 설정
- 관리자 API 별도 인증·권한
- SQLAlchemy 바인딩 사용
- 운영 시 Swagger 비공개 또는 제한
- 비밀키는 Secret Manager 또는 환경변수로 관리

### 7.2 부정행위 탐지

다음 이벤트를 별도 보안 로그에 기록한다.

- 짧은 시간에 비정상적으로 많은 행동
- 동일 action ID에 서로 다른 payload
- 오래된 revision에서 반복 요청
- 불가능한 인벤토리 수량
- 클라이언트 시간과 서버 시간의 과도한 차이
- 비정상적으로 높은 희귀 변이 획득
- 탐험 요청 속도 초과

초기에는 자동 정지보다 `risk_score`를 누적하고 운영자가 검토하도록 한다.

---

## 8. 관측성

### 8.1 구조화 로그

```json
{
  "timestamp": "...",
  "level": "INFO",
  "service": "snail-api",
  "environment": "production",
  "requestId": "...",
  "userId": "...",
  "deviceId": "...",
  "action": "FEED_SNAIL",
  "result": "SUCCESS",
  "durationMs": 41
}
```

개인정보와 토큰은 로그에 남기지 않는다.

### 8.2 에러 추적

- 프론트엔드 Sentry
- 백엔드 Sentry
- release version·commit SHA 연결
- 사용자 ID는 내부 UUID만 전달
- 서버 오류 응답에 `request_id` 포함

### 8.3 시스템 메트릭

- API 요청 수·오류율
- p50/p95/p99 응답시간
- DB connection pool
- Redis 오류율
- 동기화 성공·실패율
- 동기화 큐 평균 길이
- action 중복 차단 수
- 트랜잭션 롤백 수
- 백그라운드 작업 실패 수

### 8.4 게임 메트릭

- DAU·WAU·MAU
- D1·D7·D30 리텐션
- 평균 세션 수·세션 시간
- 먹이 지급 횟수
- 양육자 레벨 분포
- 탐험 스태미나 소진율
- 여행 전환율
- 슬롯 구매율
- 도감 완성률
- 희귀·에픽 변이 획득률

---

## 9. 백업과 복구

### 9.1 백업

- PostgreSQL 일일 전체 백업
- 가능한 경우 Point-in-Time Recovery 활성화
- 백업 파일 암호화
- 운영 DB와 다른 저장소·리전에 보관
- 보존 기간 정책 수립
- 백업 성공 여부 자동 알림

### 9.2 복구 훈련

문서만 작성하지 않고 스테이징에서 주기적으로 복구한다.

```text
1. 백업 선택
2. 별도 DB 인스턴스에 복원
3. 무결성 검사
4. 핵심 사용자 상태 조회
5. API smoke test
6. 복구 시간 기록
```

목표:

```text
RPO: 최대 허용 데이터 손실 범위
RTO: 서비스 복구 목표 시간
```

초기 목표값은 실제 인프라 비용과 사용자 수를 기준으로 정한다.

---

## 10. 구현 단계

| 단계 | 브랜치 | 내용 | 완료 기준 |
|---|---|---|---|
| 1 | `feat/indexeddb-store` | 스냅샷·액션 큐·동기화 메타 저장 | 새로고침 후 큐 유지 |
| 2 | `feat/sync-protocol` | action batch API·revision·patch | 온라인 복귀 동기화 |
| 3 | `feat/idempotency` | action_id 저장·중복 응답 재사용 | 재전송 중복 반영 0 |
| 4 | `feat/concurrency-control` | row lock·version lock·Redis lock | 동시 소비·구매 안전 |
| 5 | `feat/economy-ledger` | 코인·인벤토리 원장 | 모든 변화 추적 가능 |
| 6 | `feat/security-baseline` | Rate Limit·CORS·CSP·검증 | 기본 보안 체크 통과 |
| 7 | `feat/observability` | 로그·Sentry·메트릭·대시보드 | 장애 원인 추적 가능 |
| 8 | `infra/backup-restore` | 자동 백업·복원 스크립트 | 스테이징 복원 성공 |
| 9 | `chore/v9-chaos-qa` | 네트워크·동시성·부하·장애 테스트 | 완료 조건 전체 통과 |

---

## 11. 테스트 시나리오

### 동기화

1. 오프라인에서 먹이 2회 수행
2. 앱 강제 종료
3. 재실행 후 큐 유지 확인
4. 온라인 복귀
5. 두 행동이 한 번씩만 반영되는지 확인

### 동시성

1. 먹이 1개 보유
2. 두 기기에서 동시에 먹이 요청
3. 한 요청만 성공
4. 재고가 음수가 되지 않음
5. 성공 요청만 원장에 기록

### 멱등성

1. 동일 `action_id` 요청 10회 전송
2. 최초 결과와 동일한 응답 반환
3. 데이터 변화는 한 번만 발생

### 충돌

1. 기기 A와 B에서 동시에 달팽이 이름 변경
2. version이 오래된 요청은 409
3. 최신 상태와 충돌 해결 UI 표시

### 장애

1. DB 저장 도중 예외 발생
2. 아이템만 차감되고 스탯은 미반영되는 부분 저장이 없어야 함
3. 트랜잭션 전체 롤백 확인

---

## 12. 완료 조건

1. 오프라인 행동이 IndexedDB에 안전하게 유지된다.
2. 온라인 복귀 시 행동이 순서대로 동기화된다.
3. 재시도·중복 전송에도 같은 행동이 한 번만 처리된다.
4. 여러 기기에서 동시에 재화를 사용해도 음수·복제가 발생하지 않는다.
5. 탐험·부화·여행 등 서버 전용 행동이 오프라인에서 실행되지 않는다.
6. 코인과 아이템의 모든 변동을 원장에서 추적할 수 있다.
7. 주요 오류가 Sentry와 구조화 로그에 연결된다.
8. API 오류율·지연·동기화 실패율을 대시보드에서 확인할 수 있다.
9. 자동 백업이 실행되고 스테이징 복구 훈련에 성공한다.
10. 부하·동시성·네트워크 장애 테스트가 통과한다.

---

# 10차 MVP — 어드민·라이브 운영·자동 배포·확장 기반

> 목표 기간: 3~5주  
> 선행 조건: 9차 동기화·안정성 완료  
> 검증 가설: **“코드 재배포 없이 게임 밸런스와 이벤트를 운영하고, 안전하게 업데이트하며, 사용자 문제를 빠르게 복구할 수 있는가?”**

---

## 1. 목표

10차는 게임을 “개발 완료된 프로그램”에서 “지속적으로 운영 가능한 서비스”로 전환한다.

핵심 목표:

1. 운영자가 밸런스와 콘텐츠를 원격으로 변경한다.
2. 사용자 상태와 거래 이력을 안전하게 조회·복구한다.
3. 기간 한정 이벤트와 공지를 예약한다.
4. CI/CD와 DB 마이그레이션으로 안전하게 배포한다.
5. 기능 플래그와 단계적 출시로 장애 범위를 줄인다.
6. 향후 친구·결제·시즌·랭킹을 추가할 기반을 마련한다.

---

## 2. 포함 범위

| # | 기능 | 내용 |
|---|---|---|
| 1 | 운영자 인증 | 관리자 계정·역할·감사 로그 |
| 2 | 사용자 조회 | 계정·달팽이·인벤토리·원장·행동 로그 조회 |
| 3 | 보상·복구 | 코인·아이템 지급, 상태 복원, 정지·해제 |
| 4 | 원격 게임 설정 | 먹이·레벨·탐험·변이·장식·미션 수치 관리 |
| 5 | 설정 버전 관리 | 초안·검수·배포·롤백 |
| 6 | 이벤트 운영 | 기간 한정 출석·미션·보상·확률 이벤트 |
| 7 | 공지사항 | 앱 내 공지·점검 안내 |
| 8 | Feature Flag | 사용자 비율·앱 버전별 기능 노출 |
| 9 | CI/CD | 테스트·이미지 빌드·스테이징·운영 배포 자동화 |
| 10 | 무중단 마이그레이션 | 구버전 클라이언트와 호환되는 DB 변경 절차 |

---

## 3. 어드민 권한

### 3.1 역할

| 역할 | 권한 |
|---|---|
| Viewer | 사용자·지표·로그 읽기 |
| Operator | 공지·이벤트·보상 처리 |
| Game Designer | 밸런스 설정 작성·검수 요청 |
| Admin | 설정 배포·사용자 정지·권한 관리 |
| Super Admin | 최고 권한, 최소 인원 |

### 3.2 보안 원칙

- 일반 사용자 인증과 관리자 인증 분리
- 관리자 MFA 적용
- IP 제한 또는 VPN 검토
- 모든 변경에 사유 입력
- 변경 전·후 값을 감사 로그로 저장
- 삭제보다 비활성화 사용
- 운영 DB 직접 수정 금지
- 민감 작업은 2인 승인 옵션 제공

### 3.3 감사 로그

```sql
admin_audit_logs
- id UUID
- admin_user_id UUID
- action VARCHAR
- target_type VARCHAR
- target_id VARCHAR
- before JSONB
- after JSONB
- reason TEXT
- created_at TIMESTAMPTZ
```

---

## 4. 사용자 운영 도구

### 4.1 사용자 검색

검색 조건:

- 내부 사용자 ID
- 닉네임
- 소셜 provider ID
- 달팽이 이름
- 생성일
- 최근 접속일
- 정지 상태
- 위험 점수

### 4.2 사용자 상세 화면

```text
기본 정보
├─ 인증 수단
├─ 가입일·최근 접속
├─ 양육자 레벨·세대
└─ 앱·기기 버전

게임 상태
├─ 달팽이 목록
├─ 코인·인벤토리
├─ 미션·탐험
├─ 도감·앨범
└─ 장식·배경

이력
├─ 행동 로그
├─ 코인 원장
├─ 아이템 원장
├─ 동기화 오류
└─ 관리자 조치
```

### 4.3 운영자 보상

운영자는 잔액을 직접 덮어쓰지 않는다.

```text
[보상 지급]
- 코인 +100
- 상추 +5
- 사유: 탐험 중복 차감 보상
```

서버는 원장에 `ADMIN_COMPENSATION` 사유로 추가 기록한다.

### 4.4 상태 복구

전체 DB를 과거로 되돌리지 않고 사용자 단위로 복구한다.

권장 방식:

- 행동 로그와 원장을 기준으로 보정
- 주요 상태 변경 전 스냅샷 저장
- 복구 작업도 새로운 감사 이벤트로 기록
- 복구 전 미리보기 제공

---

## 5. 원격 게임 설정

### 5.1 설정 대상

- 먹이 가격·회복량·경험치·행복도
- 레벨 필요 경험치
- 양육자 레벨 해금 조건
- 변이 확률
- 세대 보정
- 탐험 스태미나
- 탐험 보상 확률
- 맵별 변이 가중치
- 미션 조건·보상
- 장식 패시브
- 접속 보상
- 부재 발견 확률
- 최대 달팽이 슬롯
- 상점 상품 가격

### 5.2 데이터 모델

```sql
game_config_versions
- id UUID
- version INTEGER UNIQUE
- status VARCHAR
- config JSONB
- created_by UUID
- reviewed_by UUID NULL
- created_at TIMESTAMPTZ
- published_at TIMESTAMPTZ NULL
```

상태:

```text
DRAFT
→ IN_REVIEW
→ APPROVED
→ ACTIVE
→ ARCHIVED
```

### 5.3 설정 예시

```json
{
  "foods": {
    "lettuce": {
      "price": 10,
      "hungerRecovery": 30,
      "snailExp": 10,
      "keeperExp": 2
    }
  },
  "exploration": {
    "dailySearches": 10,
    "rewards": {
      "coins": 0.55,
      "food": 0.25,
      "empty": 0.15,
      "wildEgg": 0.05
    }
  }
}
```

### 5.4 검증

배포 전에 자동 검증한다.

```text
확률 합이 1인지
가격·보상이 음수가 아닌지
레벨 곡선이 역전되지 않는지
존재하지 않는 item ID를 참조하지 않는지
해금 레벨이 유효한지
최대 슬롯 범위를 넘지 않는지
```

### 5.5 설정 적용

- 활성 설정은 Redis에 캐시
- 서버는 `config_version`을 게임 행동 결과에 기록
- 새 버전 활성화 시 캐시 무효화
- 문제 발생 시 이전 버전으로 즉시 롤백
- 진행 중 행동은 요청 시작 시 읽은 버전으로 끝까지 처리

---

## 6. 이벤트 시스템

### 6.1 지원 이벤트

- 출석 보너스
- 탐험 보상 증가
- 희귀 변이 확률 증가
- 특정 먹이 할인
- 기간 한정 미션
- 시즌 장식 지급
- 공지와 보상 우편

### 6.2 데이터 모델

```sql
live_events
- id UUID
- event_type VARCHAR
- title VARCHAR
- status VARCHAR
- starts_at TIMESTAMPTZ
- ends_at TIMESTAMPTZ
- timezone_policy VARCHAR
- config JSONB
- created_by UUID
- created_at TIMESTAMPTZ
```

### 6.3 이벤트 판정

```text
기본 게임 설정
  +
활성 이벤트 수정치
  =
최종 행동 규칙
```

예:

```text
황금 기본 확률 2%
+ 이벤트 보너스 2%p
= 이벤트 기간 최종 4%
```

확률 배수인지 퍼센트포인트 추가인지 설정 스키마에서 명확히 구분한다.

### 6.4 이벤트 안전장치

- 시작·종료 시각 미리보기
- 중복 이벤트 충돌 검증
- 예상 보상량 시뮬레이션
- 긴급 중지
- 사용자별 1회 보상 중복 방지
- 이벤트 종료 후 결과 리포트

---

## 7. 공지와 우편함

### 7.1 공지

```sql
notices
- id
- title
- body
- priority
- starts_at
- ends_at
- min_app_version
- created_at
```

지원 기능:

- 일반 공지
- 점검 공지
- 긴급 공지
- 특정 앱 버전에만 표시
- 읽음 상태 저장

### 7.2 우편함

이벤트·장애 보상을 즉시 인벤토리에 넣는 대신 우편함으로 지급할 수 있다.

```sql
mailbox_messages
- id
- user_id
- title
- body
- rewards JSONB
- expires_at
- claimed_at
- created_at
```

보상 수령은 멱등성·트랜잭션을 적용한다.

---

## 8. Feature Flag와 단계적 출시

### 8.1 사용 목적

- 신규 탐험 맵 일부 사용자 테스트
- 새로운 교배 기능 내부 테스트
- 서버 변경을 먼저 배포하고 UI는 나중에 활성화
- 오류 발생 시 배포를 되돌리지 않고 기능만 비활성화
- A/B 테스트

### 8.2 조건

```text
전체 사용자
특정 내부 계정
사용자 ID 해시 기반 5%
앱 버전
OS
가입 시점
국가·시간대
양육자 레벨
```

### 8.3 원칙

- 경제에 영향을 주는 A/B 테스트는 별도 실험 ID 기록
- 사용자 그룹은 실험 도중 가능하면 고정
- 플래그 제거 일정을 정함
- 오래된 플래그를 코드에 방치하지 않음

---

## 9. CI/CD

### 9.1 Pull Request 파이프라인

```text
ruff / formatter
→ mypy 또는 pyright
→ unit test
→ integration test
→ migration test
→ security scan
→ Docker build
```

프론트:

```text
lint
→ unit test
→ PWA build 검증
→ Playwright E2E
```

### 9.2 배포 파이프라인

```text
main merge
→ 이미지 빌드
→ 스테이징 배포
→ DB migration
→ smoke test
→ 승인
→ 운영 canary 배포
→ 메트릭 확인
→ 전체 배포
```

### 9.3 버전

- API 버전: `/v1`
- 서버 릴리스 버전
- 클라이언트 앱 버전
- 게임 설정 버전
- DB 마이그레이션 버전

각 로그와 행동 기록에서 네 버전을 확인할 수 있어야 한다.

---

## 10. 무중단 DB 마이그레이션

DB 변경은 Expand–Migrate–Contract 순서를 따른다.

### 예시: 컬럼 이름 변경

잘못된 방식:

```text
기존 컬럼 삭제
→ 새 컬럼 추가
→ 새 서버 배포
```

권장 방식:

```text
1. 새 컬럼 추가
2. 서버가 구·신 컬럼 모두 읽을 수 있게 배포
3. 새 컬럼에도 동시 쓰기
4. 기존 데이터 백필
5. 읽기를 새 컬럼으로 전환
6. 구버전 클라이언트 종료 확인
7. 기존 컬럼 제거
```

### 필수 자동 검증

- 빈 DB에서 최신 버전까지 migration 성공
- 운영 직전 버전에서 최신 버전 migration 성공
- downgrade 필요 여부 검토
- 데이터 백필 재실행 가능
- migration 실행 시간 측정
- 장시간 테이블 락 여부 확인

---

## 11. 백그라운드 작업

Worker가 담당할 작업:

- 이벤트 시작·종료
- 우편 만료
- 통계 집계
- 오래된 idempotency key 정리
- 오래된 행동 로그 아카이브
- 푸시 알림 후보 생성
- 공유 카드 이미지 생성
- 설정 배포 후 캐시 무효화
- 위험 계정 점수 집계

작업 규칙:

1. 작업 자체도 멱등성을 가진다.
2. 실패 시 재시도 횟수와 backoff를 둔다.
3. Dead Letter Queue 또는 실패 작업 목록을 둔다.
4. 한 작업 실패가 전체 큐를 막지 않게 한다.
5. 사용자 보상 작업은 원장과 중복 방지 키를 사용한다.

---

## 12. 구현 단계

| 단계 | 브랜치 | 내용 | 완료 기준 |
|---|---|---|---|
| 1 | `feat/admin-auth` | 관리자 계정·역할·MFA·감사 로그 | 권한별 접근 제어 |
| 2 | `feat/admin-users` | 사용자 검색·상세·원장·행동 조회 | CS 대응 가능 |
| 3 | `feat/admin-compensation` | 보상·정지·복구 작업 | 모든 조치 감사 기록 |
| 4 | `feat/remote-config` | 설정 CRUD·검증·버전·롤백 | 재배포 없이 밸런스 변경 |
| 5 | `feat/live-events` | 이벤트 예약·활성화·종료 | 기간 이벤트 실행 |
| 6 | `feat/notices-mailbox` | 공지·우편·보상 수령 | 중복 수령 방지 |
| 7 | `feat/feature-flags` | 조건별 플래그·단계적 출시 | 일부 사용자만 기능 노출 |
| 8 | `infra/ci-cd` | PR 검사·스테이징·canary·운영 배포 | 자동 배포 파이프라인 |
| 9 | `infra/zero-downtime-db` | Expand–Migrate–Contract 절차 | 무중단 스키마 변경 |
| 10 | `chore/v10-ops-qa` | 권한·설정·이벤트·롤백 훈련 | 완료 조건 전체 통과 |

---

## 13. 완료 조건

1. 관리자가 역할별 권한으로 어드민에 접근한다.
2. 사용자 상태·달팽이·재화·행동·동기화 오류를 조회할 수 있다.
3. 운영자 보상과 복구가 원장·감사 로그를 남긴다.
4. 먹이·탐험·변이·미션 수치를 재배포 없이 변경할 수 있다.
5. 설정 배포 전 검증과 승인 절차가 동작한다.
6. 문제 있는 설정을 즉시 이전 버전으로 롤백할 수 있다.
7. 기간 한정 이벤트를 예약하고 자동 시작·종료할 수 있다.
8. 공지·우편 보상이 중복 없이 전달된다.
9. Feature Flag로 일부 사용자에게만 기능을 노출할 수 있다.
10. PR부터 스테이징·운영까지 CI/CD가 자동화된다.
11. DB 변경이 구버전 클라이언트를 깨뜨리지 않는다.
12. 배포 실패·설정 오류·이벤트 오류에 대한 롤백 훈련을 완료한다.

---

# 11. 전체 구현 우선순위

## 필수 순서

```text
8차 계정·서버 저장
    ↓
8차 핵심 행동 서버 권위화
    ↓
8차 기존 데이터 마이그레이션
    ↓
9차 멱등성·동시성·원장
    ↓
9차 오프라인 동기화
    ↓
9차 로그·백업·복구
    ↓
10차 어드민·원격 설정
    ↓
10차 이벤트·Feature Flag·CI/CD
```

오프라인 동기화를 서버 권위화보다 먼저 구현하면 충돌 규칙이 복잡해진다.  
어드민을 원장과 감사 로그보다 먼저 만들면 운영자 조작을 추적하기 어렵다.

---

# 12. 단계별 출시 판단

## 8차 출시 가능 기준

- 계정과 서버 저장 안정
- 기존 데이터 이전 안정
- 핵심 행동 서버 판정
- 온라인 플레이 정상

이 단계에서 제한적인 클로즈드 베타가 가능하다.

## 9차 출시 가능 기준

- 오프라인 큐 안정
- 중복 지급·동시성 방어
- 로그·모니터링·백업
- 장애 복구 가능

이 단계부터 공개 베타 또는 소규모 정식 출시가 적합하다.

## 10차 출시 가능 기준

- 어드민 운영
- 밸런스 원격 변경
- 이벤트·공지
- 자동 배포·롤백

이 단계부터 라이브 서비스와 지속적인 콘텐츠 운영이 가능하다.

---

# 13. 권장 개발 원칙

1. **게임 상태보다 행동을 저장한다.**  
   상태 스냅샷만 있으면 중복 지급 원인을 찾기 어렵다.

2. **서버가 최종 판정한다.**  
   프론트는 예상 연출을 할 수 있지만 재화·확률·보상은 서버 결과를 따른다.

3. **모든 경제 변화는 원장을 남긴다.**  
   코인 값을 임의로 덮어쓰지 않는다.

4. **모든 쓰기 API는 멱등성을 고려한다.**  
   모바일 네트워크에서는 동일 요청 재전송이 정상적인 상황이다.

5. **시간은 서버 기준으로 처리한다.**  
   일일 초기화·쿨다운·감쇠에 기기 시각을 신뢰하지 않는다.

6. **DB와 API는 구버전 클라이언트를 고려한다.**  
   PWA 서비스 워커 때문에 이전 클라이언트가 일정 기간 남을 수 있다.

7. **운영자 변경도 사용자 행동만큼 기록한다.**  
   복구와 보상은 반드시 사유와 전후 상태를 남긴다.

8. **마이크로서비스는 실제 병목이 생긴 뒤 검토한다.**  
   초기에는 모듈형 모놀리스가 개발·테스트·트랜잭션에 유리하다.

---

# 14. 최종 상태

10차까지 완료되면 게임은 다음 수준에 도달한다.

```text
단말 저장형 PWA
→ 계정 기반 서버 저장 게임
→ 오프라인 동기화 가능한 안정적 서비스
→ 밸런스·이벤트·사용자 복구가 가능한 라이브 게임
```

이 기반 이후에는 다음 기능을 비교적 안전하게 확장할 수 있다.

- 친구 정원 방문
- 사진·공유 카드
- 시즌 패스
- 광고 보상
- 인앱결제
- 교배·유전자
- 랭킹
- 길드·커뮤니티
- 푸시 알림
- 글로벌 타임존 이벤트

핵심은 콘텐츠를 더 추가하는 것이 아니라, **데이터를 잃지 않고, 중복 지급하지 않고, 장애를 발견하고, 운영자가 복구할 수 있는 게임**을 만드는 것이다.
