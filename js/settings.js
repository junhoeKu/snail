/**
 * SettingsModule — 설정 화면 (게임 규칙 안내 / 데이터 초기화)
 * 전역 네임스페이스: SettingsModule
 */
const SettingsModule = (function () {
  'use strict';

  /** 게임 규칙 안내 — 수치는 GAME.CONFIG에서 가져와 문서와 어긋나지 않게 한다 */
  function render() {
    const c = GAME.CONFIG;
    const rules = [
      (c.DECAY_INTERVAL_MIN / 60) + '시간마다 배고픔 +' + c.DECAY_HUNGER + ', 행복 -' + c.DECAY_HAPPINESS + ' (미접속 시간 포함)',
      '먹이 주기: 코인 +' + c.FEED_COINS + ' · 효과는 먹이마다 달라요 (상점 참고)',
      '양육자 레벨: 돌봄 행동으로 XP — 새 먹이와 탐험 확장이 해금돼요',
      '쓰다듬기: 행복 +' + c.PET_HAPPINESS + ' (달팽이를 직접 터치, 언제든 가능)',
      '접속 보상: 하루 1회 코인 +' + c.DAILY_COINS,
      '달팽이 레벨업 필요 경험치: 레벨 × ' + c.EXP_PER_LEVEL
    ];

    const list = document.getElementById('rules-list');
    list.innerHTML = '';
    rules.forEach(function (rule) {
      const li = document.createElement('li');
      li.textContent = rule;
      list.appendChild(li);
    });

    _renderSoundToggle();
    _renderMailbox();

    // 관리자 모드 표시
    const versionEl = document.querySelector('.settings-version');
    const base = versionEl.textContent.replace(' · 🛠️ ADMIN', '');
    versionEl.textContent = base + (DB.Player.get().admin ? ' · 🛠️ ADMIN' : '');
  }

  /** 우편함 — 서버 모드 전용 (졸업 달팽이 엽서 / 보상) */
  function _renderMailbox() {
    const section = document.getElementById('mailbox-section');
    if (!Api.enabled()) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');

    Api.mailbox().then(function (res) {
      const list = document.getElementById('mailbox-list');
      const badge = document.getElementById('mailbox-badge');
      const messages = res.messages || [];
      const unread = messages.filter(function (m) { return !m.claimed; }).length;
      badge.textContent = unread;
      badge.classList.toggle('hidden', unread === 0);

      list.innerHTML = '';
      if (messages.length === 0) {
        const li = document.createElement('li');
        li.className = 'mailbox-empty';
        li.textContent = '아직 도착한 편지가 없어요. 여행 간 달팽이가 가끔 소식을 전해요.';
        list.appendChild(li);
        return;
      }
      messages.forEach(function (m) {
        list.appendChild(_mailCard(m));
      });
    }).catch(function () { /* 오프라인 등 무시 */ });
  }

  function _mailCard(m) {
    const li = document.createElement('li');
    li.className = 'mailbox-card' + (m.claimed ? ' claimed' : '');

    const info = document.createElement('div');
    info.className = 'mailbox-info';
    const title = document.createElement('div');
    title.className = 'mailbox-title';
    title.textContent = '✉️ ' + m.title;
    const body = document.createElement('div');
    body.className = 'mailbox-body';
    body.textContent = m.body;
    info.appendChild(title);
    info.appendChild(body);
    li.appendChild(info);

    const coins = (m.rewards && m.rewards.coins) || 0;
    if (m.claimed) {
      const done = document.createElement('span');
      done.className = 'mailbox-done';
      done.textContent = '수령 완료';
      li.appendChild(done);
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary mailbox-claim';
      btn.textContent = coins ? '🪙 ' + coins + ' 받기' : '받기';
      btn.addEventListener('click', function () {
        btn.disabled = true;
        Api.claimMail(m.id).then(function () {
          Sound.play('coin');
          Toast.show('🪙 편지 속 용돈 +' + coins + ' 코인!');
          App.refreshHeader();
          _renderMailbox();
        }).catch(function (err) {
          btn.disabled = false;
          Api.Net.fail(err);
        });
      });
      li.appendChild(btn);
    }
    return li;
  }

  function _renderSoundToggle() {
    const on = DB.Player.get().sound_on !== false;
    document.getElementById('btn-sound-toggle').textContent =
      on ? '🔊 효과음 켜짐 — 탭해서 끄기' : '🔇 효과음 꺼짐 — 탭해서 켜기';
  }

  function _toggleSound() {
    const player = DB.Player.get();
    player.sound_on = player.sound_on === false;
    DB.Player.save(player);
    if (Api.enabled()) Api.updateSettings({ sound_on: player.sound_on }).catch(function () { /* 무시 */ });
    _renderSoundToggle();
    if (player.sound_on) Sound.play('tap'); // 켤 때만 확인음
  }

  // ── 백업 & 복구 ───────────────────────────────────────

  const BACKUP_PREFIX = 'SNAIL1.';

  function _encodeBackup() {
    const json = JSON.stringify(DB.exportAll());
    return BACKUP_PREFIX + btoa(unescape(encodeURIComponent(json)));
  }

  /** @returns {object|null} */
  function _decodeBackup(code) {
    try {
      const trimmed = (code || '').trim();
      if (trimmed.indexOf(BACKUP_PREFIX) !== 0) return null;
      return JSON.parse(decodeURIComponent(escape(atob(trimmed.slice(BACKUP_PREFIX.length)))));
    } catch (e) {
      return null;
    }
  }

  function _exportBackup() {
    const code = _encodeBackup();
    const done = function () { Toast.show('📋 백업 코드를 복사했어요. 안전한 곳에 보관하세요!'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, function () { _showCodeFallback(code); });
    } else {
      _showCodeFallback(code);
    }
  }

  /** 클립보드 미지원 시 코드를 입력창에 노출해 수동 복사 */
  function _showCodeFallback(code) {
    const input = document.getElementById('backup-input');
    input.value = code;
    input.select();
    Toast.show('코드를 길게 눌러 직접 복사해주세요.');
  }

  function _importBackup() {
    const data = _decodeBackup(document.getElementById('backup-input').value);
    if (!data) {
      Toast.show('올바른 백업 코드가 아니에요.', 'warn');
      return;
    }
    Toast.confirm({
      title: '백업 복구',
      message: '지금 데이터를 백업 코드의 데이터로 완전히 덮어씁니다. 되돌릴 수 없어요!',
      confirmLabel: '복구',
      onConfirm: function () {
        if (DB.importAll(data)) location.reload();
        else Toast.show('복구에 실패했어요. 코드를 확인해주세요.', 'warn');
      }
    });
  }

  function bind() {
    document.getElementById('btn-sound-toggle').addEventListener('click', _toggleSound);
    document.getElementById('btn-backup-export').addEventListener('click', _exportBackup);
    document.getElementById('btn-backup-import').addEventListener('click', _importBackup);
    document.getElementById('btn-reset').addEventListener('click', function () {
      Toast.confirm({
        title: '데이터 초기화',
        message: '달팽이와 모든 기록이 삭제됩니다. 되돌릴 수 없어요!',
        confirmLabel: '초기화',
        onConfirm: function () {
          DB.reset();
          location.reload();
        }
      });
    });
  }

  return { render: render, bind: bind };
})();
