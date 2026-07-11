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
      '먹이 주기: 배고픔 -' + c.FEED_HUNGER + ', 경험치 +' + c.FEED_EXP + ', 행복 +' + c.FEED_HAPPINESS + ', 코인 +' + c.FEED_COINS,
      '쓰다듬기: 행복 +' + c.PET_HAPPINESS + ' (달팽이를 직접 터치, 언제든 가능)',
      '접속 보상: 하루 1회 코인 +' + c.DAILY_COINS,
      '상추 가격: ' + c.FOOD_PRICE + '코인 · 레벨업 필요 경험치: 레벨 × ' + c.EXP_PER_LEVEL
    ];

    const list = document.getElementById('rules-list');
    list.innerHTML = '';
    rules.forEach(function (rule) {
      const li = document.createElement('li');
      li.textContent = rule;
      list.appendChild(li);
    });

    _renderSoundToggle();

    // 관리자 모드 표시
    const versionEl = document.querySelector('.settings-version');
    const base = versionEl.textContent.replace(' · 🛠️ ADMIN', '');
    versionEl.textContent = base + (DB.Player.get().admin ? ' · 🛠️ ADMIN' : '');
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
    _renderSoundToggle();
    if (player.sound_on) Sound.play('tap'); // 켤 때만 확인음
  }

  function bind() {
    document.getElementById('btn-sound-toggle').addEventListener('click', _toggleSound);
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
