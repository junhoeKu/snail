# 10차 MVP 구현 계획 — 어드민·원격 설정·라이브 이벤트·CI/CD

> 작성일: 2026-07-12
> 선행 조건: 9차(배포·동시성·오프라인 큐·관측성) 완료
> 모체 문서: [8~10차 통합 계획(GPT)](8~10차_MVP_백엔드_인프라_구현계획_GPT.md)의 10차 장을 1인 운영 규모에 맞게 재구성
> 목표 기간: 3~4주
> 검증 가설: **"코드 재배포 없이 밸런스·이벤트를 운영하고, 사용자 문제를 원장 기반으로 복구할 수 있는가?"**

---

## 0. 통합 계획 대비 조정 (1인 운영 스케일)

| 통합 계획 제안 | 이 계획의 결정 | 근거 |
|---|---|---|
| 역할 5종(Viewer~Super Admin) + MFA | **Admin 단일 역할** + 별도 어드민 토큰 + 감사 로그 | 운영자가 1명. 역할 분리는 운영자가 늘 때 |
| 어드민 웹 대시보드 | **API 우선** + 최소 HTML 조회 페이지 1장 | 화면보다 감사 가능한 API가 본질 |
| 설정 상태 5단계(DRAFT→…→ARCHIVED) | **DRAFT → ACTIVE → ARCHIVED** 3단계 | 검수자가 없으므로 IN_REVIEW/APPROVED 생략, 자동 검증으로 대체 |
| 우편함(mailbox) | **이월** — 운영자 보상은 즉시 지급 + 다음 접속 토스트 | 우편함 UI·만료·수령 멱등까지 만들 규모 아님 |
| Feature Flag 독립 시스템 | 게임 설정 JSON 안의 `flags` 섹션 (사용자 해시 비율) | 저장·배포·롤백을 설정 버전과 공유 |
| canary 배포 | 스테이징 검증 → 운영 단일 배포 | 인스턴스 1대에서 canary는 무의미 |
| 백그라운드 워커 | 도입 안 함 — 이벤트 시작/종료도 lazy 판정 | 8차부터의 무배치 원칙 유지 |

제외 유지: 결제·푸시·랭킹·친구 (통합 계획 §14의 확장 후보 — 11차 이후).

---

## 1. 목표

1. 사용자 조회·보상·복구·정지를 **원장과 감사 로그를 남기며** 수행한다
2. 먹이 가격·변이 확률·탐험 보상 등 밸런스를 **재배포 없이** 변경하고 즉시 롤백할 수 있다
3. 기간 한정 이벤트(확률 업 등)를 예약하면 자동으로 시작·종료된다
4. 공지를 앱 내 배너로 전달한다
5. PR 검사와 배포가 GitHub Actions로 자동화된다 — **sw.js CACHE_VERSION 범프 누락을 CI가 잡는다**

---

## 2. 포함 범위

| # | 기능 | 내용 |
|---|---|---|
| 1 | 어드민 인증 | `ADMIN_TOKEN` 환경변수 + `/admin/*` 전용 의존성, 모든 쓰기에 감사 로그 |
| 2 | 사용자 운영 | 검색·상세(달팽이/재화/행동/원장)·보상 지급·정지/해제 |
| 3 | 원격 게임 설정 | `game_config_versions` — rules.py 기본값에 JSON 오버라이드 병합 |
| 4 | 설정 검증·롤백 | 배포 전 자동 검증, 이전 버전 즉시 재활성화 |
| 5 | 라이브 이벤트 | 기간·배수/가산 방식 명시된 이벤트 1종 이상 (변이 확률·탐험 보상) |
| 6 | 공지 | `notices` — 앱 내 배너, 기간·우선순위, 읽음 로컬 저장 |
| 7 | CI (PR) | ruff + pytest + node 회귀 + **CACHE_VERSION 검사** |
| 8 | CD (main) | 백엔드 이미지 빌드·배포 자동화 (프론트는 기존 Pages 자동 배포 유지) |
| 9 | 무중단 마이그레이션 | Expand–Migrate–Contract 절차를 CLAUDE.md 규칙으로 명문화 + 빈 DB/직전 버전 마이그레이션 CI 검증 |

---

## 3. 어드민

### 3.1 인증·감사

- `Authorization: Bearer <ADMIN_TOKEN>` (사용자 JWT와 완전 분리, 운영 환경에서만 발급)
- 모든 쓰기 API는 `reason` 필수:

```sql
admin_audit_logs
- id / action / target_type / target_id
- before JSONB / after JSONB / reason TEXT / created_at
```

### 3.2 API

```text
GET  /admin/users?query=          # id/닉네임/달팽이 이름 검색
GET  /admin/users/{id}            # 상태 + 최근 행동 + 원장 요약
GET  /admin/users/{id}/ledger     # 코인·인벤토리 원장
POST /admin/users/{id}/compensate # 보상 — add_coins/add_item 경유, reason 'ADMIN_COMPENSATION'
POST /admin/users/{id}/suspend    # 정지/해제 (users.suspended_at)
```

- 잔액 직접 덮어쓰기 API는 **만들지 않는다** — 모든 보정은 원장 경유 (통합 계획 원칙 3)
- 정지된 계정의 행동 API는 403, 조회는 허용
- 최소 조회 페이지: `/admin/ui` 정적 HTML 1장 (검색 + 상세 JSON 뷰) — 프레임워크 없이

---

## 4. 원격 게임 설정

### 4.1 병합 모델

```text
rules.py 기본값 (코드 — 진실의 뿌리)
  ⊕ 활성 game_config_versions.config (JSONB 오버라이드 — 없으면 빈 객체)
  = 유효 설정 (요청 시작 시 1회 로드, 행동 끝까지 고정)
```

- 오버라이드는 **기존 키만** 덮을 수 있다 (새 키 추가 금지 → 오타·미지원 키 차단)
- 행동 기록(`game_actions.result`)에 `config_version` 포함 — 사후 추적
- 캐시: 프로세스 메모리 30초 TTL (Redis 없음 — 단일 인스턴스)

### 4.2 데이터 모델·상태

```sql
game_config_versions
- id / version INTEGER UNIQUE / status(DRAFT|ACTIVE|ARCHIVED)
- config JSONB / note TEXT / created_at / published_at
```

- ACTIVE는 항상 1개. 새 버전 활성화 시 이전 버전 자동 ARCHIVED
- 롤백 = ARCHIVED 버전 재활성화 (새 버전 번호로 복제)

### 4.3 활성화 전 자동 검증 (통합 계획 §5.4)

```text
변이 확률 합 == 1 · 탐험 보상 확률 합 == 1
가격·보상·회복량 음수 금지
레벨 곡선 단조 증가
존재하지 않는 item/food/variant ID 참조 금지
해금 레벨·슬롯 상한 범위 검사
```

실패 시 활성화 거부 + 실패 항목 반환. 검증기는 pytest로 자체 테스트한다.

### 4.4 클라이언트

- `GET /v1/game/config`가 유효 설정(병합 결과)을 반환 — 서버 모드 표시 수치는 이미 이 경로를 쓰므로 클라 변경 최소
- 로컬 모드는 `js/game.js` 내장값 그대로 (원격 설정 미적용 — 명시적 한계)

---

## 5. 라이브 이벤트

```sql
live_events
- id / event_type / title
- starts_at / ends_at (UTC 저장, 판정은 사용자 타임존)
- config JSONB / status(SCHEDULED|ACTIVE|ENDED|CANCELLED) / created_at
```

- **lazy 판정**: 행동 처리 시 `starts_at <= now < ends_at`인 이벤트를 조회해 유효 설정 위에 겹친다 — 워커·크론 없음
- 수정 방식을 스키마에서 강제: `{ "golden_chance_add_pp": 2 }`(퍼센트포인트 가산) vs `{ "explore_coin_mult": 2 }`(배수) — 모호한 키 금지 (통합 계획 §6.3)
- 겹치는 기간의 동종 이벤트는 생성 시 거부
- 긴급 중지: status CANCELLED → 즉시 무효
- 클라: `GET /v1/game/state`에 활성 이벤트 요약 포함 → 홈 상단 배너 "🌟 황금 확률 UP! ~7/20"
- 1차 제공 이벤트 2종: 변이 확률 가산 / 탐험 코인 배수

---

## 6. 공지

```sql
notices
- id / title / body / priority(normal|urgent)
- starts_at / ends_at / created_at
```

- `GET /v1/notices/active` (인증 불요, 60초 캐시 허용 — sw는 `/v1/*` 미캐시 원칙 유지)
- 클라: 설정 탭 목록 + urgent는 부팅 시 모달 1회. 읽음 처리는 LocalStorage (`sn_read_notices`) — 서버 상태 아님
- 점검 공지: urgent + 기간으로 표현 (별도 점검 모드는 만들지 않음)

---

## 7. CI/CD (GitHub Actions)

### 7.1 PR 파이프라인 (`.github/workflows/ci.yml`)

```text
backend: ruff check → pytest (PostgreSQL 서비스 컨테이너 — 동시성 테스트 포함)
frontend: node --check js/*.js → jsdom 회귀(테스트 하네스를 tests/로 정식 이관)
migration: 빈 DB → alembic upgrade head / 직전 태그 스키마 → head
sw-guard: js/css/assets 변경 diff에 sw.js CACHE_VERSION 변경이 없으면 실패 ★
```

★ `sw-guard`는 v1.0.1 사고(핫픽스가 캐시에 막혀 미전달)의 재발을 기계적으로 차단한다.

### 7.2 배포 (main merge)

```text
프론트: GitHub Pages 자동 배포 (기존 유지 — 변경 없음)
백엔드: Docker 이미지 빌드 → 스테이징 배포 → /healthz smoke → (수동 승인) → 운영 배포
```

- 배포 실패 시 이전 이미지로 롤백 (호스팅 CLI)
- 버전 각인: 이미지에 commit SHA, `/healthz` 응답에 `release` 포함 — 로그·Sentry와 연결

### 7.3 무중단 DB 마이그레이션 규칙 (CLAUDE.md에 추가)

```text
컬럼 rename/삭제는 Expand → Migrate → Contract 3배포로 나눈다.
PWA 특성상 구버전 클라이언트가 수 주 남는다 — 응답 필드 제거는 최소 2릴리스 유예.
모든 마이그레이션은 CI의 빈 DB·직전 버전 업그레이드 검사를 통과해야 머지된다.
```

---

## 8. 구현 단계 (브랜치 단위)

| 단계 | 브랜치 | 내용 | 완료 기준 |
|---|---|---|---|
| 1 | `infra/ci-pipeline` | PR 검사 4종 (sw-guard 포함) + 테스트 정식 이관 | PR에서 자동 실행 |
| 2 | `feat/admin-core` | 어드민 인증·감사 로그·사용자 조회 | 감사 로그 없는 쓰기 0 |
| 3 | `feat/admin-compensation` | 보상·정지 (원장 경유) | 보상이 원장·감사에 기록 |
| 4 | `feat/remote-config` | 설정 버전·검증·병합·롤백 | 재배포 없이 가격 변경·롤백 |
| 5 | `feat/live-events` | 이벤트 2종 + lazy 판정 + 클라 배너 | 예약→자동 시작·종료 |
| 6 | `feat/notices` | 공지 API + 클라 배너/모달 | 기간 공지 노출·만료 |
| 7 | `infra/cd-pipeline` | 이미지 빌드·스테이징·운영 배포 자동화 | main merge로 배포 완료 |
| 8 | `chore/v10-ops-qa` | 롤백 훈련(설정·이벤트·배포) + v1.2.0 | §9 전체 통과 |

---

## 9. 완료 조건

1. 어드민의 모든 쓰기 작업이 사유와 전후 값을 감사 로그에 남긴다
2. 사용자의 상태·행동 이력·코인/아이템 원장을 어드민 API로 조회할 수 있다
3. 운영자 보상이 원장(`ADMIN_COMPENSATION`)을 경유하며, 잔액 직접 수정 경로가 존재하지 않는다
4. 상추 가격을 재배포 없이 변경하고, 문제 시 1분 내 이전 버전으로 롤백할 수 있다
5. 검증 실패 설정(확률 합≠1 등)은 활성화가 거부된다
6. 예약한 이벤트가 기간에 맞춰 자동 시작·종료되고 클라 배너에 표시된다
7. 긴급 공지가 부팅 모달로 표시된다
8. PR에서 백엔드·프론트 테스트와 sw-guard가 자동 실행되고, 실패 시 머지가 막힌다
9. main merge로 스테이징 → 운영 배포가 자동 진행되고 롤백 훈련을 1회 통과했다
10. 기존 게임 동작(서버·로컬 모드)이 무회귀 — 이벤트 없는 평시 판정 결과가 9차와 동일하다

---

## 10. 11차로 넘기는 것

살아있는 생태계(디오라마)·슬롯 8마리 — [11차_MVP_구현계획.md](11차_MVP_구현계획.md).
그 외 이월: 우편함, Google 로그인 프론트 UI, Apple 로그인, 공유 카드, 푸시 알림.
