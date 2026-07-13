/**
 * RaceModule — 달팽이 경주 미니게임 (12차)
 * 전역 네임스페이스: RaceModule
 * 5마리가 결승선까지 달리고, 1등 레인을 맞히면 보상 코인. 판정은 서버(권위)/로컬(오프라인).
 */
const RaceModule = (function () {
  'use strict';

  const LANE_COLORS = ['brown', 'red', 'yellow', 'lime', 'sky']; // 레인별 고정 색
  let _busy = false;

  function _track() { return document.getElementById('race-track'); }

  /** 경주 화면 진입 — 트랙/예측 버튼 초기화 */
  function start() {
    _busy = false;
    document.getElementById('minigame-hub').classList.add('hidden');
    document.getElementById('race-view').classList.remove('hidden');
    document.getElementById('race-status').textContent = '몇 번 달팽이가 1등할까요? 맞히면 ' +
      GAME.CONFIG.RACE_REWARD + '골드!';
    document.getElementById('race-left').textContent = '';
    _buildTrack();
    _buildGuess();
  }

  function _buildTrack() {
    const track = _track();
    track.innerHTML = '';
    for (let i = 0; i < GAME.CONFIG.RACE_LANES; i++) {
      const lane = document.createElement('div');
      lane.className = 'race-lane';
      const num = document.createElement('span');
      num.className = 'race-num';
      num.textContent = (i + 1);
      const snail = document.createElement('img');
      snail.className = 'race-snail';
      snail.src = GAME.spritePath(LANE_COLORS[i], 'adult');
      snail.dataset.lane = i;
      lane.appendChild(num);
      lane.appendChild(snail);
      track.appendChild(lane);
    }
  }

  function _buildGuess() {
    const box = document.getElementById('race-guess');
    box.innerHTML = '';
    for (let i = 0; i < GAME.CONFIG.RACE_LANES; i++) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost race-pick';
      btn.textContent = (i + 1) + '번';
      btn.addEventListener('click', function () { _run(i); });
      box.appendChild(btn);
    }
  }

  /** 예측 후 경주 실행 */
  function _run(guess) {
    if (_busy) return;
    _busy = true;
    document.querySelectorAll('.race-pick').forEach(function (b) { b.disabled = true; });
    document.getElementById('race-status').textContent = '🏁 출발! (' + (guess + 1) + '번 응원 중)';

    if (Api.enabled()) {
      Api.race(guess).then(function (res) {
        _animate(res.times, function () { _finish(res.winner, res.won, res.coins, res.left, res.player); });
      }).catch(function (err) {
        _busy = false;
        document.querySelectorAll('.race-pick').forEach(function (b) { b.disabled = false; });
        if (err && err.code === 'no_race') Toast.show('오늘 경주를 다 했어요. 내일 다시!', 'warn');
        else Api.Net.fail(err);
      });
      return;
    }

    // 로컬 모드 — 하루 제한 + 보상 직접 처리
    const player = DB.Player.get();
    const today = DB.today();
    let state = (player.minigame_race && player.minigame_race.date === today)
      ? player.minigame_race : { date: today, count: 0 };
    if (state.count >= GAME.CONFIG.RACE_MAX_PER_DAY) {
      _busy = false;
      document.querySelectorAll('.race-pick').forEach(function (b) { b.disabled = false; });
      Toast.show('오늘 경주를 다 했어요. 내일 다시!', 'warn');
      return;
    }
    state.count += 1;
    player.minigame_race = state;
    const result = GAME.raceRoll();
    const won = guess === result.winner;
    let coins = 0;
    if (won) { coins = GAME.CONFIG.RACE_REWARD; player.coins += coins; }
    DB.Player.save(player);
    _animate(result.times, function () {
      _finish(result.winner, won, coins, GAME.CONFIG.RACE_MAX_PER_DAY - state.count, null);
    });
  }

  /** times(초)대로 각 레인 달팽이를 결승선(트랙 우측 끝)까지 이동 */
  function _animate(times, done) {
    const track = _track();
    const lane = track.querySelector('.race-lane');
    const snail0 = track.querySelector('.race-snail');
    // 결승선까지 이동 거리 = 레인 폭 − (시작 left + 달팽이 폭 + 여백)
    const startLeft = snail0 ? snail0.offsetLeft : 24;
    const snailW = snail0 ? snail0.offsetWidth : 40;
    const goal = Math.max(40, lane.clientWidth - startLeft - snailW - 2);

    const snails = track.querySelectorAll('.race-snail');
    let maxT = 0;
    snails.forEach(function (el) {
      const t = times[Number(el.dataset.lane)];
      maxT = Math.max(maxT, t);
      el.style.transition = 'transform ' + t + 's cubic-bezier(.35,.1,.6,1)';
      requestAnimationFrame(function () {
        el.style.transform = 'translateX(' + goal + 'px)';
      });
    });
    setTimeout(done, maxT * 1000 + 250);
  }

  function _finish(winner, won, coins, left, player) {
    // 1등 강조
    _track().querySelectorAll('.race-snail').forEach(function (el) {
      if (Number(el.dataset.lane) === winner) el.classList.add('race-winner');
    });
    document.getElementById('race-status').innerHTML =
      '🥇 <b>' + (winner + 1) + '번</b> 달팽이 우승!' +
      (won ? ' 예측 성공 <b>+' + coins + '골드</b>!' : ' 아쉬워요, 다음 기회에!');
    document.getElementById('race-left').textContent = '오늘 남은 경주: ' + left + '/' + GAME.CONFIG.RACE_MAX_PER_DAY;

    if (won) { Sound.play('coin'); FX.confetti(14); }
    if (player) { // 서버 모드: 미러 갱신
      localStorage.setItem('sn_player', JSON.stringify(player));
    }
    App.refreshHeader();

    // 다시 하기 버튼
    const box = document.getElementById('race-guess');
    box.innerHTML = '';
    const again = document.createElement('button');
    again.className = 'btn btn-primary btn-wide';
    again.textContent = '한 번 더!';
    again.addEventListener('click', start);
    box.appendChild(again);
    _busy = false;
  }

  function bind() {
    document.getElementById('btn-race-back').addEventListener('click', function () {
      document.getElementById('race-view').classList.add('hidden');
      document.getElementById('minigame-hub').classList.remove('hidden');
    });
  }

  return { start: start, bind: bind };
})();
