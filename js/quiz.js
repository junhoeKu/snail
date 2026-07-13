/**
 * QuizModule — 달팽이 퀴즈 미니게임 (13차)
 * 전역 네임스페이스: QuizModule
 * 랜덤 문항 1개를 풀고, 정답이면 보상 코인. 정답 검증·보상은 서버(권위)/로컬(오프라인).
 */
const QuizModule = (function () {
  'use strict';

  let _index = 0;
  let _busy = false;

  function start() {
    _busy = false;
    _index = Math.floor(Math.random() * GAME.QUIZ_BANK.length);
    document.getElementById('minigame-hub').classList.add('hidden');
    document.getElementById('quiz-view').classList.remove('hidden');

    const item = GAME.QUIZ_BANK[_index];
    document.getElementById('quiz-question').textContent = item.q;
    document.getElementById('quiz-result').textContent = '';
    document.getElementById('quiz-left').textContent = '';

    const box = document.getElementById('quiz-choices');
    box.innerHTML = '';
    item.choices.forEach(function (choice, i) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost quiz-choice';
      btn.textContent = choice;
      btn.addEventListener('click', function () { _answer(i, btn); });
      box.appendChild(btn);
    });
  }

  function _answer(choice, btnEl) {
    if (_busy) return;
    _busy = true;
    document.querySelectorAll('.quiz-choice').forEach(function (b) { b.disabled = true; });

    if (Api.enabled()) {
      Api.quiz(_index, choice).then(function (res) {
        _showResult(choice, res.correct, res.answer, res.coins, res.left, res.player, btnEl);
      }).catch(function (err) {
        _busy = false;
        document.querySelectorAll('.quiz-choice').forEach(function (b) { b.disabled = false; });
        if (err && err.code === 'no_quiz') Toast.show('오늘 퀴즈를 다 풀었어요. 내일 또!', 'warn');
        else Api.Net.fail(err);
      });
      return;
    }

    // 로컬 모드 — 하루 제한 + 보상
    const player = DB.Player.get();
    const today = DB.today();
    let state = (player.minigame_quiz && player.minigame_quiz.date === today)
      ? player.minigame_quiz : { date: today, count: 0 };
    if (state.count >= GAME.CONFIG.QUIZ_MAX_PER_DAY) {
      _busy = false;
      document.querySelectorAll('.quiz-choice').forEach(function (b) { b.disabled = false; });
      Toast.show('오늘 퀴즈를 다 풀었어요. 내일 또!', 'warn');
      return;
    }
    state.count += 1;
    player.minigame_quiz = state;
    const answer = GAME.QUIZ_BANK[_index].answer;
    const correct = choice === answer;
    let coins = 0;
    if (correct) { coins = GAME.CONFIG.QUIZ_REWARD; player.coins += coins; }
    DB.Player.save(player);
    _showResult(choice, correct, answer, coins, GAME.CONFIG.QUIZ_MAX_PER_DAY - state.count, null, btnEl);
  }

  function _showResult(choice, correct, answer, coins, left, player, btnEl) {
    const buttons = document.querySelectorAll('.quiz-choice');
    buttons.forEach(function (b, i) {
      if (i === answer) b.classList.add('quiz-correct');
    });
    if (!correct && btnEl) btnEl.classList.add('quiz-wrong');

    document.getElementById('quiz-result').innerHTML = correct
      ? '⭕ 정답이에요! <b>+' + coins + '골드</b>'
      : '❌ 아쉬워요! 정답은 <b>' + GAME.QUIZ_BANK[_index].choices[answer] + '</b>';
    document.getElementById('quiz-left').textContent = '오늘 남은 퀴즈: ' + left + '/' + GAME.CONFIG.QUIZ_MAX_PER_DAY;

    if (correct) { Sound.play('coin'); FX.confetti(12); }
    if (player) localStorage.setItem('sn_player', JSON.stringify(player));
    App.refreshHeader();

    const box = document.getElementById('quiz-choices');
    const again = document.createElement('button');
    again.className = 'btn btn-primary btn-wide';
    again.textContent = '다음 문제!';
    again.addEventListener('click', start);
    box.appendChild(again);
    _busy = false;
  }

  function bind() {
    document.getElementById('btn-quiz-back').addEventListener('click', function () {
      document.getElementById('quiz-view').classList.add('hidden');
      document.getElementById('minigame-hub').classList.remove('hidden');
    });
  }

  return { start: start, bind: bind };
})();
