// 도리존 집계 연결(js/track.js) 테스트 — 언제 어떤 이벤트를 보내는지만 확인한다.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, '..', 'js/track.js'), 'utf8');
function load(withDz) {
  const sent = [];
  const window = withDz === false ? {} : { dz: (e) => sent.push(e) };
  const ctx = { window };
  vm.runInNewContext(code + '\n;this.Track = Track;', ctx);
  return { Track: ctx.Track, sent, window };
}

{ // 그날 첫 돌봄 행동이 플레이 시작. 하루에 한 번만 보낸다.
  const { Track, sent } = load();
  Track.care(['moved'], '2026-11-19');
  assert.deepStrictEqual(sent, [], '돌봄이 아닌 행동은 세지 않는다');
  Track.care(['fed', 'mission_done'], '2026-11-19');
  Track.care(['petted'], '2026-11-19');
  Track.care(['explored'], '2026-11-19');
  assert.deepStrictEqual(sent, ['play_start']);
  Track.care(['petted'], '2026-11-20');
  assert.deepStrictEqual(sent, ['play_start', 'play_start'], '날이 바뀌면 다시 센다');
}
{ // 오늘의 돌봄 완주가 판 완료
  const { Track, sent } = load();
  Track.done();
  assert.deepStrictEqual(sent, ['play_complete']);
}
{ // 앱처럼 열어둔 채 날이 바뀌어 돌아오면 방문을 다시 기록한다
  const { Track, sent } = load();
  Track.resume('2026-11-19');
  Track.resume('2026-11-19');
  assert.deepStrictEqual(sent, [], '같은 날 다시 돌아온 건 새 방문이 아니다');
  Track.resume('2026-11-20');
  assert.deepStrictEqual(sent, ['pageview']);
}
{ // 집계 스크립트가 없거나(광고 차단) 고장나도 게임은 멀쩡해야 한다
  const { Track } = load(false);
  assert.doesNotThrow(() => { Track.care(['fed'], 'd'); Track.done(); Track.resume('a'); Track.resume('b'); });
  const broken = load();
  broken.window.dz = () => { throw new Error('boom'); };
  assert.doesNotThrow(() => broken.Track.done());
}
console.log('track ok');
