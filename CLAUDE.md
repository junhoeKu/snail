# CLAUDE.md - Snail (달팽이 키우기)

## 프로젝트 개요

> **달팽이 한 마리를 부화시켜 먹이를 주고 성장시키는 데일리 케어 게임**
> 현실 시간 시스템(30분마다 배고픔 증가)으로 "하루에 여러 번 접속할 이유"를 만들고, `알 → 부화 → 먹이 → 성장 → 코인 → 구매 → 더 성장`의 핵심 루프 하나만 검증한다. Vanilla HTML/CSS/JS SPA + LocalStorage 기반. 상세 범위는 [1차_MVP_구현계획.md](docs/1차_MVP_구현계획.md)를 따른다.

---

## 작업 원칙

### 1. 논의 → 설계 → 계획 → 구현 → 리뷰

코드를 먼저 작성하지 않는다. 반드시 이 순서를 따른다:

1. **논의**: 요구사항을 정확히 이해하고 질문한다
2. **설계**: 2-3개 접근법을 비교하고 추천한다
3. **계획**: 구체적인 파일 목록과 변경 사항을 문서화한다
4. **구현**: 계획대로만 구현한다. 범위를 벗어나지 않는다
5. **리뷰**: 구현 결과를 spec(1차_MVP_구현계획.md)과 대조하여 검증한다
6. **갱신**: 커밋 및 코드 구현이 완료되면 해당 부분을 꼼꼼하게 단계별로 메모리에 반영 및 갱신하세요.

이 사이클을 충분히 반복한다. 급하다고 건너뛰지 않는다.

### 2. 기존 코드의 일관성을 지킨다

- 새 코드는 기존 패턴을 따른다. 더 나은 패턴이 있어도 혼자 바꾸지 않는다
- 폴더 구조, 네이밍, 모듈 스타일을 기존 코드에서 먼저 확인한다
- "개선"이라는 이름으로 기존 컨벤션을 무시하지 않는다
- 각 JS 파일은 **IIFE로 감싼 단일 전역 네임스페이스**를 노출한다 (`DB`, `GAME`, `HomeModule`, `ShopModule`, `Toast`, `App`). 새 모듈도 이 패턴을 따른다
- 모듈 간 의존은 전역 네임스페이스 호출로만 한다. 빌드 도구/번들러/import 구문을 도입하지 않는다
- 시간 관련 값은 모두 **로컬 시간(브라우저 기준)**으로 통일한다. 날짜 키는 `YYYY-MM-DD`(접속 보상 등), 타임스탬프는 ISO 문자열(`last_seen`, `last_walk`, `created_at`)을 쓴다. 시간 감쇠 계산과 저장 포맷을 섞지 말고 일관되게 맞춘다

### 3. 현재 기술 스택을 유지한다 (프레임워크 도입 금지)

- MVP 1차는 **Vanilla HTML/CSS/JavaScript + LocalStorage**로만 진행한다. React/Next/Vue/Firebase/Supabase/React Native/게임엔진(Phaser 등)을 붙이지 않는다 (1차_MVP_구현계획.md §2.2)
- 외부 라이브러리는 CDN으로 로드되는 것(Font Awesome)만 사용한다. 새 의존성을 임의로 추가하지 않는다
- 빌드 단계 없이 정적 파일을 브라우저가 직접 로드한다. 트랜스파일·번들 과정을 만들지 않는다
- 달팽이 그래픽은 이모지/CSS로 표현한다. 스프라이트·캔버스 애니메이션을 도입하지 않는다
- **도메인 로직과 화면을 분리한다**: `game.js`는 DOM을 조작하지 않고, DB를 직접 저장하지 않으며, 입력을 받아 결과만 반환한다 (순수 함수 유지)
- 데이터 저장/조회는 반드시 `DB` 모듈을 통한다. `localStorage`를 직접 호출하지 않는다 (초기화 등 예외는 명시)

### 4. 확인 없이 추측하지 않는다

- 파일을 수정하기 전에 반드시 Read로 읽는다
- 모듈 API를 사용할 때 기억에 의존하지 않고 실제 코드를 확인한다 (`DB.Snail.get` 시그니처, `GAME` export 등)
- 브라우저 콘솔 에러, LocalStorage 실제 값, grep 결과 등 실제 증거를 기반으로 판단한다
- 스크린샷 분석 시 보이는 그대로를 말한다. 추측으로 "정상"이라 하지 않는다
- 게임 수치(배고픔 증가량, 보상 코인 등)는 임의로 정하지 않는다. `GAME.CONFIG`와 1차_MVP_구현계획.md §3을 기준으로 하고, 바꿀 때는 문서를 먼저 갱신한다

### 5. git commit 규칙

- 리뷰를 통과한 구현에 대해서 commit할 것인지 사용자에게 물어봐라.
- commit message는 angular convention을 따른다. (`feat(game): ...`, `fix(db): ...`, `chore(app): ...`)
- 파일 수정 전 반드시 Read로 현재 내용 확인
- 구조 변경 시 "복사 → 전환 → 삭제" 순서 (기존 기능 유지)
- 기능 단위 브랜치를 사용한다 (`feat/db`, `feat/game-core` 등, 1차_MVP_구현계획.md §8)

### 6. Issue 생성 규칙

- 한국어로 작성한다.
- 해결 방법보다 "문제"를 먼저 설명한다
- 하나의 Issue는 하나의 문제만 다룬다

### 7. Pull Request 작성 규칙

- 하나의 Issue는 하나 또는 다수의 PR을 통해 해결한다.
- PR 본문에 해결하고자 하는 Issue를 포함한다.
- 기능 추가와 리팩토링을 함께 하지 않는다.
- PR 제목은 angular convention을 따른다.
- PR 본문에는 아래 항목들을 반드시 포함한다:
  - `## 무엇을 변경했는가`
  - `## 왜 변경했는가`
  - `## 현재 PR에서 고려되지 않은 부분`
  - `## 테스트 방법`
  - `## Follow-ups`

---

## 모듈/파일 규칙

```
1 JS 파일 = 1 IIFE = 1 전역 네임스페이스
도메인 로직(game.js) = 순수 함수, DOM/DB 미접근
데이터 계층(db.js) = LocalStorage 접근 단일 창구
화면 모듈(*.js) = DB·GAME 호출 + DOM 렌더링
CSS = 역할별 파일 분리 (theme/components/화면별)
```

---

### 파일 구조 (목표)

```
snail/
├── index.html              ← SPA 진입점. 모든 CSS/JS 로드 + 화면 컨테이너
├── css/
│   ├── theme.css           ← 색상 변수/배경
│   ├── components.css      ← 글로벌 컴포넌트 (버튼/카드/모달/토스트/스탯 바)
│   ├── home.css            ← 홈(달팽이) 화면
│   └── shop.css            ← 상점 화면
└── js/
    ├── db.js               ← ★ LocalStorage 데이터 계층 (Player/Snail)
    ├── game.js             ← ★ 핵심 도메인 로직 (부화/먹이/성장/시간감쇠, 순수 함수)
    ├── home.js             ← 홈 화면 렌더링 + 행동 버튼 (먹이주기/산책)
    ├── shop.js             ← 상점 (상추 구매)
    ├── toast.js            ← 토스트/모달/성장 연출
    └── app.js              ← 앱 컨트롤러 (부팅/시간 정산/라우팅)
```

> 문서는 `docs/`에 모은다 (1차_MVP_구현계획.md §1.3). `README.md`만 관례에 따라 루트에 둔다.

---

## 아키텍처 핵심 규칙

### 데이터 모델 (LocalStorage 키)

| 키 | 모듈 | 내용 |
|------|------|------|
| `sn_player` | `DB.Player` | `coins`, `food`(상추 수), `last_seen`, `last_daily_reward`, `last_walk`, `background` |
| `sn_snail` | `DB.Snail` | `name`, `level`, `exp`, `hunger`, `happiness`, `stage`, `color`, `created_at` |

### 4개 성장 단계 (`GAME.STAGES`)

`egg 🥚(부화 전)` · `baby 🐌(Lv1-4)` · `junior 🐌(Lv5-9, 껍질 커짐)` · `adult 🐌(Lv10+, 색상 변화)`

### 핵심 함수 (`game.js` export)

| 함수 | 역할 |
|------|------|
| `GAME.CONFIG` | 게임 수치 상수 (감쇠/보상/가격, 1차_MVP_구현계획.md §3) |
| `GAME.hatch(snail, name)` | 알 → 아기 부화 |
| `GAME.feed(snail, player)` | 먹이 주기 → `{ snail, player, events }` |
| `GAME.walk(snail, player, nowISO)` | 산책 (쿨다운 4시간) |
| `GAME.claimDaily(player, todayKey)` | 일일 접속 보상 |
| `GAME.applyTimeDecay(snail, lastSeenISO, nowISO)` | 경과 시간 배고픔/행복도 정산 |
| `GAME.gainExp(snail, amount)` | 경험치 → 레벨업 → 단계 변화 |
| `GAME.buyFood(player)` | 상추 구매 |

### 게임 규칙 (요약)

```
30분 경과   → hunger +5, happiness -5 (미접속분 last_seen 기준 일괄 정산)
먹이 주기   → hunger -30, exp +10, happiness +5, 코인 +2 (상추 1 소모)
산책        → happiness +10, 코인 +10 (쿨다운 4시간)
접속 보상   → 코인 +20 (하루 1회)
레벨업      → 필요 exp = level × 20
```

행동 함수는 모두 `{ snail, player, events }`를 반환하고, 화면 모듈이 `events`로 토스트/연출을 처리한다. 실패 시(코인 부족/쿨다운) 상태를 바꾸지 않는다.

### 절대 하지 말 것

- `game.js`에서 DOM 조작이나 `localStorage`/`DB` 직접 저장 — 순수 함수 유지
- `localStorage`를 `DB` 모듈 밖에서 직접 호출 — 반드시 `DB`를 경유
- MVP 범위 밖 기능 임의 추가 (달팽이 다종/교배/도감/친구/이벤트/미니게임/수익화 등, 1차_MVP_구현계획.md §2.3)
- 게임 수치를 코드 곳곳에 하드코딩 — 반드시 `GAME.CONFIG`에 모은다
- 사용자 확인 없이 저장된 플레이어/달팽이 데이터 초기화
- 프레임워크/번들러/빌드 단계/게임엔진 도입

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| Frontend | Vanilla HTML/CSS/JavaScript (SPA, IIFE 모듈) |
| 저장소 | LocalStorage (클라이언트 퍼시스턴스) |
| 그래픽 | 이모지 + CSS 애니메이션 |
| 아이콘 | Font Awesome 6.4 (CDN) |
| 배포 | GitHub Pages / Vercel Static Hosting |

---

## 테스트 & 검증

수동 검증 중심이다 (테스트 프레임워크 없음, 1차_MVP_구현계획.md §9).

```bash
# 로컬 실행 (택1)
python3 -m http.server 8000        # → http://localhost:8000
# 또는 VS Code Live Server 확장
```

```js
// 브라우저 DevTools Console 검증
DB.Player.get();
DB.Snail.get();
GAME.feed(DB.Snail.get(), DB.Player.get());
GAME.applyTimeDecay(DB.Snail.get(), "2026-07-10T09:00:00", new Date().toISOString());
GAME.expToNext(DB.Snail.get().level);
```

배포 전 기준: 콘솔 에러 0개 · 새로고침 후 데이터 유지 · LocalStorage 삭제 후 알/이름짓기 온보딩 정상 시작 · 미접속 후 재접속 시 배고픔 정산 정확 · 모바일 390px 깨짐 없음.

---

## Review guidelines

- Always write in Korean.
- Do not log PII or secrets.
- LocalStorage 스키마 일관성과 저장 실패(파싱 오류/용량 초과) 방어를 확인한다.
- 게임 로직(game.js)이 DOM/DB에 의존하지 않는지 확인한다.
- 게임 수치가 `GAME.CONFIG` 밖에 하드코딩되지 않았는지 확인한다.
- Point out unnecessary or redundant code.
- Prefer maintainable code. (나중에 백엔드 DB로 옮길 수 있는 구조 유지)

---

## 참고 링크

- MVP 구현 계획: [docs/1차_MVP_구현계획.md](docs/1차_MVP_구현계획.md)
- MDN Web Storage API: https://developer.mozilla.org/docs/Web/API/Web_Storage_API
