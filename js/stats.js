/**
 * StatsModule — 유저 탭 (양육자 레벨 / 도감 / 앨범 / 성장 일지)
 * 전역 네임스페이스: StatsModule
 * 개체(달팽이) 상세는 홈의 개체 팝업(HomeModule)이 담당한다.
 */
const StatsModule = (function () {
  'use strict';

  function render() {
    _renderKeeper();
    _renderAlbum();
    _renderJournal();
  }

  // ── 양육자 카드 ────────────────────────────────────────

  /** 다음 해금 안내 (먹이/스태미나 중 가장 가까운 것) */
  function _nextUnlockText(level) {
    let next = null;
    Object.keys(GAME.FOOD_DEFS).forEach(function (id) {
      const def = GAME.FOOD_DEFS[id];
      if (def.unlockLevel > level && (!next || def.unlockLevel < next.level)) {
        next = { level: def.unlockLevel, label: def.emoji + ' ' + def.label };
      }
    });
    GAME.CONFIG.KEEPER_STAMINA_LEVELS.forEach(function (gate) {
      if (gate > level && (!next || gate < next.level)) {
        next = { level: gate, label: '🧭 탐험 스태미나 +2' };
      }
    });
    return next
      ? '다음 해금: Lv.' + next.level + ' — ' + next.label
      : '모든 해금을 달성했어요! 🏅';
  }

  function _renderKeeper() {
    const player = DB.Player.get();
    const keeper = player.keeper || { level: 1, xp: 0 };
    const needed = GAME.keeperXpToNext(keeper.level);

    document.getElementById('keeper-level').textContent = keeper.level;
    document.getElementById('bar-keeper').style.width =
      Math.min(100, (keeper.xp / needed) * 100) + '%';
    document.getElementById('keeper-xp-text').textContent = keeper.xp + ' / ' + needed + ' XP';
    document.getElementById('keeper-next').textContent = _nextUnlockText(keeper.level);
  }

  // 도감은 DexModule(js/dex.js)로 분리됨 (12차 탭 개편)

  // ── 앨범 ──────────────────────────────────────────────

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

      const img = document.createElement('img');
      img.className = 'dex-img album-img';
      img.src = GAME.spritePath(record.color, 'adult');
      img.alt = record.name;

      const info = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'album-name';
      title.textContent = record.name + ' · ' + record.generation + '세대';
      const desc = document.createElement('div');
      desc.className = 'album-desc';
      const rarityTag = variant && variant.rarity !== 'common'
        ? '(' + GAME.RARITIES[variant.rarity].label + ') ' : '';
      desc.textContent = (variant ? variant.label : '갈색') + ' 껍질 ' + rarityTag + '· ' +
        (personality ? personality.label : '?') + ' · Lv.' + record.level +
        ' · ' + days + '일 동안 함께함';
      info.appendChild(title);
      info.appendChild(desc);

      li.appendChild(img);
      li.appendChild(info);
      list.appendChild(li);
    });
  }

  // ── 성장 일지 ─────────────────────────────────────────

  function _journalTime(ts) {
    const d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

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

  function bind() {
    // 유저 탭은 표시 전용 (개체 버튼은 홈 팝업)
  }

  return { render: render, bind: bind };
})();
