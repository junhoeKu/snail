/**
 * StatsModule — 스탯 화면 (경험치/배고픔/행복 + 성장 단계 안내)
 * 전역 네임스페이스: StatsModule
 */
const StatsModule = (function () {
  'use strict';

  function _setBar(id, percent) {
    document.getElementById(id).style.width = Math.max(0, Math.min(100, percent)) + '%';
  }

  /** 다음 성장 단계 안내 문구 */
  function _nextStageText(snail) {
    if (snail.stage === 'baby') {
      return 'Lv.' + GAME.STAGES.junior.minLevel + '이 되면 껍질이 커져요!';
    }
    if (snail.stage === 'junior') {
      return 'Lv.' + GAME.STAGES.adult.minLevel + '이 되면 색이 변해요!';
    }
    return '최종 단계까지 자랐어요. 계속 아껴주세요!';
  }

  function render() {
    const snail = DB.Snail.get();

    if (snail.stage === 'egg') {
      document.getElementById('stats-name').textContent = '???';
      document.getElementById('stats-level').textContent = '-';
      document.getElementById('stats-stage').textContent = '알';
      document.getElementById('exp-text').textContent = '- / -';
      document.getElementById('hunger-text').textContent = '-';
      document.getElementById('happiness-text').textContent = '-';
      _setBar('bar-exp', 0);
      _setBar('bar-hunger', 0);
      _setBar('bar-happiness', 0);
      document.getElementById('stats-next').textContent = '알을 부화시키면 스탯이 표시돼요.';
      return;
    }

    document.getElementById('stats-name').textContent = snail.name;
    document.getElementById('stats-level').textContent = snail.level;
    document.getElementById('stats-stage').textContent = GAME.STAGES[snail.stage].label;

    const expNeeded = GAME.expToNext(snail.level);
    document.getElementById('exp-text').textContent = snail.exp + ' / ' + expNeeded;
    _setBar('bar-exp', (snail.exp / expNeeded) * 100);

    document.getElementById('hunger-text').textContent = snail.hunger + '%';
    _setBar('bar-hunger', snail.hunger);

    document.getElementById('happiness-text').textContent = snail.happiness + '%';
    _setBar('bar-happiness', snail.happiness);

    document.getElementById('stats-next').textContent = _nextStageText(snail);
  }

  return { render: render };
})();
