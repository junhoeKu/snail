# 9차 MVP 구현 계획 — 배포 완성·동시성·오프라인 큐·운영 안정성

> 작성일: 2026-07-12
> 선행 조건: 8차(계정·서버 저장·서버 권위형) 코드 완료 — [8차_MVP_구현계획.md](8차_MVP_구현계획.md)
> 모체 문서: [8~10차 통합 계획(GPT)](8~10차_MVP_백엔드_인프라_구현계획_GPT.md)의 9차 장을 이 프로젝트 규모에 맞게 재구성
> 목표 기간: 3~4주
> 검증 가설: **"네트워크가 불안정하거나 두 기기에서 동시에 플레이해도 중복·유실 없이 안전하게 상태가 유지되는가?"**

---

## 0. 통합 계획 대비 현재 구현 현황

8차 코드는 완료됐고, 통합 계획의 9차 항목 일부는 8차에서 선반영됐다. 이 계획은 **남은 것만** 다룬다.

### 0.1 이미 구현됨 (8차에서 선반영 — 재작업 금지)

| 통합 계획 항목 | 구현 위치 |
|---|---|
| 멱등성 (단건) | `game_actions.request_id` unique + `service.find_action` 응답 재사용 |
| 코인 원장 | `currency_ledger` + `service.add_coins` 단일 경유 |
| 토큰 회전 | refresh 회전 + `auth_sessions` 서버 폐기 |
| CORS 최소화 | `CORS_ORIGINS` 환경변수 |
| 시크릿 관리 | `.env` / 환경변수, 커밋 금지 |
| 트랜잭션 행동 처리 | `actions._run()` — 행동 전체가 한 트랜잭션 |
| 서버 시간 판정 | lazy 감쇠 + 사용자 타임존 일일 키 |

### 0.2 부분 구현 (이번에 완성)

| 항목 | 현재 | 남은 것 |
|---|---|---|
| 낙관적 잠금 | `snails.version` 컬럼만 존재 | 이름/위치 갱신에 실제 검증 적용 (§3.3) |
| 멱등성 | 같은 `request_id` 응답 재사용 | payload 해시 검증 (같은 ID·다른 내용 = 보안 이벤트) (§3.1) |
| revision | 타임스탬프 의사값 | 진짜 단조 증가 카운터 (§4.1) |

### 0.3 미구현 (이번 범위)

배포(스테이징/운영 분리), 오프라인 액션 큐, 동시성 락, 인벤토리 원장, Rate Limit, 구조화 로그·에러 추적, 백업·복구 훈련, 동시성·장애 테스트.

### 0.4 이번에도 도입하지 않는 것

- ❌ **Redis** — 현 규모에서 불필요. 단일 API 인스턴스 + PostgreSQL 락으로 충분. 도입 신호: 인스턴스 2대 이상 스케일아웃 또는 Rate Limit 저장소 병목
- ❌ **IndexedDB 전면 이전** — 통합 계획은 IndexedDB를 제안하나, 이 게임의 상태는 수 KB 수준이라 기존 LocalStorage 미러를 유지하고 **액션 큐만** 추가한다 (§5). 저장 계층 이중화는 복잡도만 늘린다
- ❌ 백그라운드 워커 / 마이크로서비스 / Kubernetes
- ❌ 어드민·원격 설정·이벤트 (→ 10차)

---

## 1. 목표

1. **배포 완성**: 운영 API를 실제로 띄우고 라이브 사이트가 서버 모드로 동작한다 (8차 완료 조건의 마지막 항목)
2. 두 기기가 동시에 행동해도 재화 음수·복제가 발생하지 않는다
3. 오프라인/불안정 네트워크에서 돌봄 행동이 유실되지 않고, 복귀 시 중복 없이 반영된다
4. 코인뿐 아니라 아이템 변동도 원장으로 추적된다
5. 장애가 나면 로그·에러 추적으로 원인을 찾고, 백업에서 복구할 수 있다

---

## 2. 포함 범위

| # | 기능 | 내용 |
|---|---|---|
| 1 | 운영 배포 | API 호스팅(Fly.io/Railway) + PostgreSQL(Neon 등) + `config.js` 연결, 스테이징 분리 |
| 2 | 동시성 제어 | 재화 변동 행동에 row lock(`FOR UPDATE`), 이름/위치에 낙관적 잠금 |
| 3 | 멱등 강화 | request_id + payload 해시, 불일치 시 거부 + 보안 로그 |
| 4 | revision 동기화 | 단조 증가 카운터, `GET /v1/game/state?after_revision=` 지원 |
| 5 | 오프라인 액션 큐 | 허용 행동을 로컬 큐에 쌓고 온라인 복귀 시 일괄 전송 |
| 6 | 인벤토리 원장 | `inventory_ledger` — 먹이·장식 증감 이력 |
| 7 | 보안 기준선 | 사용자별 Rate Limit, 입력 검증 강화, 보안 이벤트 로그 |
| 8 | 관측성 | 구조화 JSON 로그(request_id), Sentry(선택), `/healthz` |
| 9 | 백업/복구 | 일일 백업(호스팅 PITR 우선) + `pg_dump` 스크립트 + 복구 리허설 1회 |
| 10 | 검증 | 동시성·멱등·충돌·장애 pytest + 오프라인 E2E |

---

## 3. 동시성·멱등 (서버)

### 3.1 멱등 강화

```text
game_actions에 payload_hash 컬럼 추가
같은 request_id 재수신:
  payload_hash 일치 → 저장된 응답 그대로 반환 (기존 동작)
  payload_hash 불일치 → 409 + 보안 이벤트 로그 (조작 시도 의심)
```

### 3.2 비관적 잠금 — 재화가 변하는 행동

`feed / purchase / explore / graduate / hatch / mission claim`은 트랜잭션 시작 시:

```python
db.execute(select(Inventory).where(...).with_for_update())
db.execute(select(User).where(User.id == user.id).with_for_update())
```

같은 트랜잭션 안에서 `검증 → 차감 → 상태 갱신 → 원장 → revision 증가`를 끝낸다.
SQLite(dev)는 `with_for_update`가 no-op이므로 동시성 테스트는 PostgreSQL 컨테이너에서 돈다 (§8).

### 3.3 낙관적 잠금 — 충돌 가능성 낮은 데이터

이름 변경·위치 동기화는 `snails.version` 검증:

```sql
UPDATE snails SET name=:name, version=version+1
WHERE id=:id AND version=:expected;  -- 영향 0행 → 409 + 최신 상태 반환
```

클라이언트는 409 수신 시 최신 상태로 리싱크한다 (기존 `Api.Net.fail` 경로 재사용).

---

## 4. revision 동기화

### 4.1 서버

- `users.revision INTEGER` — 상태가 변할 때마다 +1 (행동 트랜잭션 내부)
- 모든 행동 응답과 `GET /v1/game/state`에 `revision` 포함
- `GET /v1/game/state?after_revision=N`: 변화 없으면 `304 상당의 {"unchanged": true}` — 폴링 비용 절감

### 4.2 클라이언트

- 미러 저장 시 revision 저장, `visibilitychange` 복귀 폴링에 `after_revision` 사용
- 응답 revision이 로컬보다 2 이상 크면(다른 기기 활동) 전체 리싱크 + "다른 기기에서 플레이했어요" 토스트

---

## 5. 오프라인 액션 큐 (클라이언트)

### 5.1 저장 구조 — LocalStorage `sn_pending_actions` (DB 모듈 경유)

```json
[{
  "request_id": "01J...",
  "type": "feed",
  "payload": { "snail_id": "...", "food_id": "lettuce" },
  "base_revision": 104,
  "created_at": "2026-07-12T12:30:00+09:00"
}]
```

### 5.2 허용 행동 (통합 계획 §3.2 기준)

| 행동 | 오프라인 | 근거 |
|---|---|---|
| 먹이 주기 | ✅ 낙관 반영 후 서버 검증 | 인벤토리 서버 재검증으로 안전 |
| 쓰다듬기 | ✅ | 수치 영향 미미 |
| 이름 변경 / 위치 / 배경 | ✅ | 낙관적 잠금으로 병합 |
| 상점 구매 | ❌ 온라인 전용 | 재화 충돌 위험 |
| 탐험 / 부화 / 여행 | ❌ 온라인 전용 | 서버 RNG·원자 처리 |

- 오프라인 낙관 반영은 **로컬 모드 GAME 함수를 그대로 재사용**해 미러에 적용 (연출 일관)
- 서버 전용 행동은 오프라인에서 버튼 비활성 + "온라인에서 할 수 있어요" 안내

### 5.3 동기화 흐름

```text
online 이벤트 / 부팅 / visibilitychange
→ 큐를 생성 순서대로 개별 전송 (기존 행동 API 재사용 — 배치 API 신설 없음)
→ 성공: 큐에서 제거, 서버 상태로 미러 덮어쓰기
→ 실패(NOT_ENOUGH_FOOD 등): 큐에서 제거 + 보정 토스트 ("오프라인에서 준 먹이가 부족했어요")
→ 네트워크 오류: 큐 유지, 다음 기회에 재시도 (request_id 동일 → 멱등)
```

> 설계 결정: 통합 계획의 `POST /v1/sync/actions` 배치 API는 만들지 않는다. 큐가 짧고(수 건) 기존 행동 API가 이미 멱등이라, 순차 재전송이 더 단순하고 검증 경로도 하나다.

---

## 6. 인벤토리 원장·보안

- `inventory_ledger`: `user_id / item_id / delta / quantity_after / reason / reference_id / created_at` — 수량 변경과 같은 트랜잭션, `service.add_item` 단일 경유 (add_coins와 동형)
- Rate Limit: `slowapi`(메모리 저장소) — 행동 API 사용자별 30회/분, 인증 API IP별 10회/분. 초과 시 429 + `Retry-After`
- 입력 검증: 이름 길이·문자 화이트리스트 서버 재검증, body 크기 제한
- 보안 이벤트 로그: 멱등 해시 불일치 / 429 반복 / 마이그레이션 이상값 — `security` 로거로 분리 기록 (자동 제재는 하지 않음)

---

## 7. 관측성·백업

- **구조화 로그**: JSON 라인 (`request_id / user_id / action / result / duration_ms`) — PII·토큰 금지. FastAPI 미들웨어로 일괄
- **에러 추적**: `SENTRY_DSN` 환경변수 있으면 활성 (프론트는 보류 — 무의존성 원칙)
- **헬스체크**: `/healthz` (DB ping 포함) — 호스팅 헬스체크·업타임 모니터 연결
- **백업**: 1순위 호스팅 PITR(Neon 기본 제공) 활성 확인, 2순위 `scripts/backup.sh`(pg_dump → 로컬/오브젝트 스토리지). **복구 리허설 1회 필수**: 스테이징 DB에 복원 → pytest smoke 통과 기록

---

## 8. 구현 단계 (브랜치 단위)

| 단계 | 브랜치 | 내용 | 완료 기준 |
|---|---|---|---|
| 1 | `infra/deploy-prod` | API·DB 운영 배포 + 스테이징 분리 + config.js 연결 | 라이브 사이트 서버 모드 동작 |
| 2 | `feat/concurrency` | row lock + 낙관적 잠금 + 멱등 payload 해시 | PostgreSQL 동시 요청 테스트 통과 |
| 3 | `feat/revision-sync` | revision 카운터 + after_revision + 클라 리싱크 | 두 기기 시나리오 통과 |
| 4 | `feat/offline-queue` | sn_pending_actions 큐 + 재전송 + 보정 UX | 오프라인 E2E 통과 |
| 5 | `feat/inventory-ledger` | add_item 원장 + 기존 경로 전환 | 모든 수량 변화 추적 |
| 6 | `feat/security-observability` | Rate Limit + 구조화 로그 + Sentry + /healthz | 부하 시 429·로그 확인 |
| 7 | `infra/backup-restore` | 백업 스크립트 + 복구 리허설 | 스테이징 복원 성공 기록 |
| 8 | `chore/v9-qa` | §9 시나리오 전체 + sw CACHE_VERSION 범프 + v1.1.0 | 완료 조건 전체 통과 |

> 배포가 1단계인 이유: 이후 단계 전부가 실 PostgreSQL·실 네트워크에서 검증돼야 의미가 있다.

---

## 9. 테스트 시나리오

1. **동시성**: 먹이 1개 보유, 두 세션이 동시에 feed → 1건만 성공, 재고 0(음수 금지), 원장 1건
2. **멱등**: 같은 request_id 10회 전송 → 응답 동일, 상태 변화 1회. 같은 ID·다른 payload → 409 + 보안 로그
3. **오프라인**: 기내모드에서 먹이 2회 → 강제 새로고침 → 큐 유지 → 온라인 복귀 → 각 1회씩만 반영
4. **오프라인 거절**: 서버 재고보다 많이 준 경우 보정 토스트 + 미러 리싱크
5. **두 기기**: A에서 구매 → B 복귀 폴링에 revision 차이 감지 → 리싱크 토스트
6. **충돌**: A·B 동시 이름 변경 → 늦은 쪽 409 → 최신 상태 반영
7. **장애**: 행동 트랜잭션 중간 예외 주입 → 부분 저장 0건 (원장·상태·행동 로그 전무)
8. **복구**: 백업 → 스테이징 복원 → smoke 통과

---

## 10. 완료 조건

1. 라이브 사이트(junhoeku.github.io/snail)가 운영 API로 서버 모드 동작한다 (게스트 생성·이전·행동 판정)
2. 두 기기 동시 사용에서 재화 음수·복제가 발생하지 않는다
3. 오프라인 돌봄 행동이 유실·중복 없이 동기화된다 (§9-3)
4. 서버 전용 행동(탐험/부화/여행/구매)은 오프라인에서 실행되지 않는다
5. 코인·아이템의 모든 변동이 원장에서 추적된다
6. Rate Limit·보안 이벤트 로그가 동작한다
7. 구조화 로그와 (설정 시) Sentry로 오류를 request_id 단위 추적할 수 있다
8. 백업이 자동 실행되고 복구 리허설 1회를 통과했다
9. §9 시나리오 전체 + 기존 회귀(pytest·jsdom·E2E) 통과, 콘솔 에러 0
10. 로컬 모드(LocalStorage 단독)는 그대로 무회귀 동작한다

---

## 11. 10차로 넘기는 것

어드민·운영자 보상·원격 게임 설정·이벤트·공지·Feature Flag·CI/CD — [10차_MVP_구현계획.md](10차_MVP_구현계획.md)
