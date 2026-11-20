/**
 * 도리존(dorizone.com) 집계 연결.
 * 집계 스크립트(https://dorizone.com/t.js)가 window.dz 를 만든다. 없거나 막혀 있어도 게임은 그대로 돈다.
 *   플레이 시작(play_start)   = 그날 첫 돌봄 행동(먹이·쓰다듬기·탐험)
 *   판 완료(play_complete)    = 오늘의 돌봄 완주
 */
const Track = (function () {
  let startedDay = null; // play_start 를 보낸 날 (하루 한 번)
  let seenDay = null;    // 마지막으로 화면에 돌아온 날

  function send(event) {
    try { if (window.dz) window.dz(event); } catch (e) { /* 집계 실패는 무시 */ }
  }

  /** 행동 이벤트 목록 → 그날 첫 돌봄이면 플레이 시작 */
  function care(events, todayKey) {
    const cared = events.indexOf('fed') !== -1 || events.indexOf('petted') !== -1 || events.indexOf('explored') !== -1;
    if (!cared || startedDay === todayKey) return;
    startedDay = todayKey;
    send('play_start');
  }

  function done() { send('play_complete'); }

  /** 화면에 돌아올 때마다 호출. 열어둔 채 날이 바뀌었으면 방문을 다시 기록한다 (페이지를 새로 열지 않는 PWA 대응). */
  function resume(todayKey) {
    if (seenDay !== null && seenDay !== todayKey) send('pageview');
    seenDay = todayKey;
  }

  return { care: care, done: done, resume: resume };
})();
