/**
 * 배포 설정 — 정적 호스팅의 .env 역할.
 *
 * ⚠️ 실제로 배포된 본인의 백엔드 주소만 넣을 것 (아래는 형식 예시일 뿐, 실존 주소 아님).
 * 비워두면 기존 LocalStorage 로컬 모드.
 *
 * 예) window.SNAIL_API_BASE = 'https://<내가-배포한-API-주소>';
 *
 * 로컬 개발(uvicorn --port 8000)은 이 파일 대신 URL 파라미터가 편하다:
 *   http://localhost:31111/?api=http://localhost:8000   ← 켜기(기억됨)
 *   http://localhost:31111/?api=                        ← 끄기
 */
window.SNAIL_API_BASE = 'https://snail-production-2a89.up.railway.app';
