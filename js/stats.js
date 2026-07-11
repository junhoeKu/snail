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
      document.getElementById('stats-traits').textContent = '';
      document.getElementById('exp-text').textContent = '- / -';
      document.getElementById('hunger-text').textContent = '-';
      document.getElementById('happiness-text').textContent = '-';
      _setBar('bar-exp', 0);
      _setBar('bar-hunger', 0);
      _setBar('bar-happiness', 0);
      document.getElementById('stats-next').textContent = '알을 부화시키면 스탯이 표시돼요.';
      _renderJournal();
      return;
    }

    document.getElementById('stats-name').textContent = snail.name;
    document.getElementById('stats-level').textContent = snail.level;
    document.getElementById('stats-stage').textContent = GAME.STAGES[snail.stage].label;

    const personality = GAME.PERSONALITIES[snail.personality];
    const variant = GAME.VARIANTS[snail.color || 'brown'];
    document.getElementById('stats-traits').textContent =
      '성격: ' + (personality ? personality.label : '?') +
      ' · 껍질: ' + (variant ? variant.label : '갈색') +
      (variant && variant.id === 'golden' ? ' ✨' : '');

    const expNeeded = GAME.expToNext(snail.level);
    document.getElementById('exp-text').textContent = snail.exp + ' / ' + expNeeded;
    _setBar('bar-exp', (snail.exp / expNeeded) * 100);

    document.getElementById('hunger-text').textContent = snail.hunger + '%';
    _setBar('bar-hunger', snail.hunger);

    document.getElementById('happiness-text').textContent = snail.happiness + '%';
    _setBar('bar-happiness', snail.happiness);

    document.getElementById('stats-next').textContent = _nextStageText(snail);
    _renderJournal();
  }

  function _journalTime(ts) {
    const d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /** 성장 일지 타임라인 (최근 순) */
  function _renderJournal() {
    const list = document.getElementById('journal-list');
    list.innerHTML = '';

    const entries = DB.Journal.get().slice().reverse();
    if (entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'journal-empty';
      li.textContent = '아직 기록이 없어요. 함께한 순간들이 여기에 쌓여요.';
      list.appendChild(li);
      return;
    }

    entries.forEach(function (entry) {
      const li = document.createElement('li');
      const time = document.createElement('span');
      time.className = 'journal-date';
      time.textContent = _journalTime(entry.ts);
      const text = document.createElement('span');
      text.textContent = entry.text;
      li.appendChild(time);
      li.appendChild(text);
      list.appendChild(li);
    });
  }

  return { render: render };
})();
