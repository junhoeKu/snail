/**
 * 배포 설정 — 정적 호스팅의 .env 역할.
 *
 * 백엔드 API 주소를 넣으면 서버 모드(계정/서버 저장)로 동작한다.
 * 비워두면 기존 LocalStorage 로컬 모드.
 *
 * 예) window.SNAIL_API_BASE = 'https://snail-api.fly.dev';
 *
 * 개발 중 임시 전환은 URL 파라미터가 더 편하다 (이 파일 수정 불필요):
 *   http://localhost:31111/?api=http://localhost:8000   ← 켜기(기억됨)
 *   http://localhost:31111/?api=                        ← 끄기
 */
window.SNAIL_API_BASE = '';
