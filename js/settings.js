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

    _showMenu(); // 설정 진입 시 항상 메뉴부터
  }

  // ── 설정 하위 라우팅 (메뉴 ↔ 세부 화면) ─────────────────

  const SUB_TITLES = { account: '계정', rules: '규칙', bg: '배경', sound: '사운드', data: '데이터', info: '정보' };

  // PWA 설치(A2HS) — beforeinstallprompt를 잡아뒀다가 정보 화면 버튼으로 띄운다
  let _installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    _installPrompt = e;
  });

  function _refreshInstall() {
    const btn = document.getElementById('btn-install');
    const hint = document.getElementById('install-hint');
    if (!btn) return;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (standalone) { btn.classList.add('hidden'); hint.classList.add('hidden'); }
    else if (_installPrompt) { btn.classList.remove('hidden'); hint.classList.add('hidden'); }
    else { btn.classList.add('hidden'); hint.classList.remove('hidden'); } // iOS 등 프롬프트 미지원
  }

  function _showMenu() {
    document.getElementById('settings-menu').classList.remove('hidden');
    document.querySelectorAll('.settings-panel').forEach(function (p) { p.classList.add('hidden'); });
    document.getElementById('settings-back').classList.remove('hidden'); // 메뉴에선 홈으로
    document.getElementById('settings-title-text').textContent = '설정';
    _renderMailbox(); // 메뉴에서만 우편함 노출
  }

  /** 뒤로가기: 하위 화면이면 메뉴로, 메뉴면 홈으로 */
  function _back() {
    const onMenu = !document.getElementById('settings-menu').classList.contains('hidden');
    if (onMenu) App.navigate('home');
    else _showMenu();
  }

  function _openSub(name) {
    document.getElementById('settings-menu').classList.add('hidden');
    document.getElementById('mailbox-section').classList.add('hidden');
    document.querySelectorAll('.settings-panel').forEach(function (p) { p.classList.add('hidden'); });
    const panel = document.getElementById('sub-' + name);
    if (panel) panel.classList.remove('hidden');
    document.getElementById('settings-back').classList.remove('hidden');
    document.getElementById('settings-title-text').textContent = SUB_TITLES[name] || '설정';
    if (name === 'bg' && typeof DecoModule !== 'undefined') DecoModule.render(); // 배경 선택 표시 갱신
    if (name === 'info') _refreshInstall();
    if (name === 'account') _renderAccount();
  }

  // ── 계정 (게스트 → Google 연결 / 기기 이전 — 서버 모드 전용, 14차 A.2) ──

  let _gisReady = false;

  function _renderAccount() {
    const status = document.getElementById('account-status');
    const slot = document.getElementById('google-btn-slot');
    const hint = document.getElementById('account-hint');
    slot.innerHTML = '';

    if (!Api.enabled()) {
      status.textContent = '🔌 로컬 모드에서는 계정 연결을 쓸 수 없어요.';
      hint.textContent = '서버 연결 시 Google 계정으로 달팽이를 안전하게 보관하고, 폰을 바꿔도 이어서 키울 수 있어요.';
      return;
    }
    const account = DB.Player.get().account || {};
    if (account.type === 'social') {
      status.textContent = '✅ Google 계정에 연결되어 있어요' +
        (account.nickname ? ' — ' + account.nickname : '');
      hint.textContent = '새 폰에서는 [설정 → 계정]에서 같은 Google로 계속하면 달팽이가 그대로 돌아와요.';
      return;
    }
    status.textContent = '👤 게스트로 플레이 중 — 기기를 잃어버리면 달팽이도 함께 사라져요.';
    hint.textContent = 'Google로 연결해두면 폰을 바꾸거나 앱을 지워도 달팽이를 되찾을 수 있어요.';
    _mountGoogleButton(slot);
  }

  function _mountGoogleButton(slot) {
    if (typeof google === 'undefined' || !google.accounts || !window.SNAIL_GOOGLE_CLIENT_ID) {
      const p = document.createElement('p');
      p.className = 'screen-desc';
      p.textContent = 'Google 버튼을 불러오지 못했어요. 네트워크 연결 후 다시 열어주세요.';
      slot.appendChild(p);
      return;
    }
    if (!_gisReady) {
      google.accounts.id.initialize({
        client_id: window.SNAIL_GOOGLE_CLIENT_ID,
        callback: _onGoogleCredential
      });
      _gisReady = true;
    }
    google.accounts.id.renderButton(slot, { theme: 'outline', size: 'large', text: 'continue_with', width: 260 });
  }

  /**
   * 한 버튼 플로우 — 의도를 진행 상황으로 추정한다:
   * 진행(부화/앨범) 있는 게스트 = 연결 우선(충돌 시 전환 확인),
   * 진행 없는 새 기기 = 로그인(기기 이전) 우선(미연결이면 지금 게스트를 연결).
   */
  function _onGoogleCredential(response) {
    const idToken = response && response.credential;
    if (!idToken) return;
    const hasProgress = DB.Snails.get().some(function (s) { return s.stage !== 'egg'; }) ||
      DB.Album.get().length > 0;
    if (hasProgress) _tryLink(idToken);
    else _tryLogin(idToken, true);
  }

  function _tryLink(idToken) {
    Api.linkGoogle(idToken).then(function () {
      Toast.show('✅ Google 계정에 연결했어요! 이제 폰을 바꿔도 안전해요.');
      DB.Journal.add('account', 'Google 계정에 연결했어요.');
      return Api.refreshFromServer();
    }).then(_renderAccount).catch(function (err) {
      if (err && err.code === 'social_conflict') {
        Toast.confirm({
          title: '이미 연결된 Google 계정',
          message: '이 Google에는 다른 달팽이 계정이 연결돼 있어요. 그 계정으로 전환할까요? 지금 이 기기의 게스트 진행은 보이지 않게 돼요.',
          confirmLabel: '전환하기',
          confirmClass: 'btn-primary',
          onConfirm: function () { _tryLogin(idToken, false); }
        });
        return;
      }
      Api.Net.fail(err);
    });
  }

  function _tryLogin(idToken, offerLinkOn404) {
    Api.loginGoogle(idToken).then(function () {
      Toast.show('✅ 내 달팽이들을 불러왔어요!');
      return Api.refreshFromServer();
    }).then(function () {
      HabitatModule.sync();
      _renderAccount();
    }).catch(function (err) {
      if (offerLinkOn404 && err && err.code === 'no_linked_account') {
        _tryLink(idToken); // 새 기기 첫 시작 — 지금 게스트를 이 Google에 연결
        return;
      }
      Api.Net.fail(err);
    });
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
    document.querySelectorAll('.settings-menu-item').forEach(function (btn) {
      btn.addEventListener('click', function () { _openSub(btn.dataset.sub); });
    });
    document.getElementById('settings-back').addEventListener('click', _back);
    document.getElementById('btn-install').addEventListener('click', function () {
      if (!_installPrompt) return;
      _installPrompt.prompt();
      _installPrompt.userChoice.finally(function () { _installPrompt = null; _refreshInstall(); });
    });
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
