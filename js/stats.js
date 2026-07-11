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
      document.getElementById('btn-graduate').classList.add('hidden');
      document.getElementById('graduate-hint').classList.add('hidden');
      _renderDex();
      _renderAlbum();
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
    _renderGraduate(snail);
    _renderDex();
    _renderAlbum();
    _renderJournal();
  }

  /** 여행 보내기 섹션 (조건 충족 시 버튼, 미충족 시 안내) */
  function _renderGraduate(snail) {
    const btn = document.getElementById('btn-graduate');
    const hint = document.getElementById('graduate-hint');

    if (GAME.canGraduate(snail)) {
      btn.classList.remove('hidden');
      hint.classList.add('hidden');
      return;
    }
    btn.classList.add('hidden');
    hint.classList.remove('hidden');
    hint.textContent = '🧳 성체 Lv.' + GAME.CONFIG.GRADUATE_MIN_LEVEL +
      '이 되면 여행을 보내고 새 알을 맞이할 수 있어요.';
  }

  function _graduate() {
    const snail = DB.Snail.get();
    if (!GAME.canGraduate(snail)) return;

    Toast.confirm({
      title: '여행 보내기',
      message: snail.name + '(이)가 넓은 세상으로 여행을 떠나요. 영영 이별이 아니라 앨범에 남고, 새 알이 도착해요!',
      confirmLabel: '보내기',
      confirmClass: 'btn-primary',
      onConfirm: _doGraduate
    });
  }

  function _doGraduate() {
    const result = GAME.graduate(DB.Snail.get(), DB.Player.get(), DB.now());
    if (result.events.indexOf('graduated') === -1) return;

    DB.Album.add(result.record);
    DB.Snail.save(result.snail);
    DB.Player.save(result.player);
    DB.Journal.add('graduate',
      result.record.name + '(' + result.record.generation + '세대)가 넓은 세상으로 여행을 떠났어요.');

    HabitatModule.pause(); // 알 상태 — 홈에서 온보딩으로 이어진다
    App.refreshHeader();
    render();
    Toast.celebrate({
      emoji: '🧳',
      title: '잘 다녀와, ' + result.record.name + '!',
      message: '추억은 앨범에 남았어요. 새 알이 도착했어요! (+' + GAME.CONFIG.GRADUATE_COINS + ' 코인)'
    });
    App.navigate('home');
  }

  function bind() {
    document.getElementById('btn-graduate').addEventListener('click', _graduate);
  }

  /** 도감 — 변이 5종 그리드 (발견: 색상+이름 / 미발견: 실루엣+???) */
  function _renderDex() {
    const discovered = GAME.discoveredVariants(DB.Album.get(), DB.Snail.get());
    const grid = document.getElementById('dex-grid');
    grid.innerHTML = '';

    Object.keys(GAME.VARIANTS).forEach(function (key) {
      const found = discovered.indexOf(key) !== -1;
      const cell = document.createElement('div');
      cell.className = 'dex-cell' + (found ? ' found' : '');

      const swatch = document.createElement('div');
      swatch.className = 'dex-swatch' + (found ? ' variant-' + key : '');

      const label = document.createElement('span');
      label.textContent = found ? GAME.VARIANTS[key].label : '???';

      cell.appendChild(swatch);
      cell.appendChild(label);
      grid.appendChild(cell);
    });

    const total = Object.keys(GAME.VARIANTS).length;
    document.getElementById('dex-count').textContent =
      discovered.length + '/' + total + (discovered.length === total ? ' · 달팽이 박사 🏅' : '');
  }

  /** 앨범 — 여행 보낸 역대 달팽이 카드 */
  function _renderAlbum() {
    const list = document.getElementById('album-list');
    list.innerHTML = '';

    const records = DB.Album.get().slice().reverse();
    if (records.length === 0) {
      const li = document.createElement('li');
      li.className = 'album-empty';
      li.textContent = '아직 여행을 떠난 달팽이가 없어요.';
      list.appendChild(li);
      return;
    }

    records.forEach(function (record) {
      const days = Math.max(1, Math.ceil(
        (new Date(record.graduated_at) - new Date(record.hatched_at)) / 86400000));
      const personality = GAME.PERSONALITIES[record.personality];
      const variant = GAME.VARIANTS[record.color];

      const li = document.createElement('li');
      li.className = 'album-card';

      const swatch = document.createElement('div');
      swatch.className = 'dex-swatch variant-' + (record.color || 'brown');

      const info = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'album-name';
      title.textContent = record.name + ' · ' + record.generation + '세대';
      const desc = document.createElement('div');
      desc.className = 'album-desc';
      desc.textContent = (variant ? variant.label : '갈색') + ' 껍질 · ' +
        (personality ? personality.label : '?') + ' · Lv.' + record.level +
        ' · ' + days + '일 동안 함께함';
      info.appendChild(title);
      info.appendChild(desc);

      li.appendChild(swatch);
      li.appendChild(info);
      list.appendChild(li);
    });
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

  return { render: render, bind: bind };
})();
