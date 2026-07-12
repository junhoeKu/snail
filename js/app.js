/**
 * App — 앱 컨트롤러 (부팅/탭 전환/지갑)
 * 전역 네임스페이스: App
 */
const App = (function () {
  'use strict';

  let _tickTimer = null;
  const TICK_MS = 60 * 1000; // 1분마다 경과 시간 확인

  /**
   * 화면(탭) 전환
   * @param {string} screen 'home' | 'stats' | 'shop' | 'deco' | 'settings'
   */
  function navigate(screen) {
    document.querySelectorAll('.screen').forEach(function (el) {
      el.classList.toggle('active', el.id === 'screen-' + screen);
    });
    document.querySelectorAll('.tab-bar .tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.screen === screen);
    });

    if (screen === 'home' && typeof HomeModule !== 'undefined') HomeModule.render();
    if (screen === 'stats' && typeof StatsModule !== 'undefined') StatsModule.render();
    if (screen === 'shop' && typeof ShopModule !== 'undefined') ShopModule.render();
    if (screen === 'explore' && typeof ExploreModule !== 'undefined') ExploreModule.render();
    if (screen === 'settings' && typeof SettingsModule !== 'undefined') SettingsModule.render();

    // 홈에서만 서식지 게임 루프를 돌린다
    if (typeof HabitatModule !== 'undefined') {
      if (screen === 'home') HabitatModule.resume();
      else HabitatModule.pause();
    }
  }

  /** 지갑(코인/선택 먹이) 표시 갱신 (값은 즉시, 연출은 FX가 덧입힘) */
  function refreshHeader() {
    const player = DB.Player.get();
    FX.bumpNumber(document.getElementById('coin-count'), player.coins);

    const def = GAME.FOOD_DEFS[player.selected_food] || GAME.FOOD_DEFS.lettuce;
    document.getElementById('wallet-food-emoji').textContent = def.emoji;
    document.getElementById('fab-food-emoji').textContent = def.emoji;
    FX.bumpNumber(document.getElementById('food-count'), (player.foods && player.foods[def.id]) || 0);
  }

  /** 양육자 XP 지급 + 레벨업/해금 연출 — 모든 모듈이 이 경로를 쓴다 (서버 모드는 서버가 판정) */
  function gainKeeperXp(action) {
    if (Api.enabled()) return;
    const result = GAME.gainKeeperXp(DB.Player.get(), action);
    DB.Player.save(result.player);
    if (result.events.indexOf('keeper_levelup') === -1) return;

    Sound.play('fanfare');
    FX.confetti(12);
    Toast.show('🧑‍🌾 양육자 레벨 업! Lv.' + result.level + ' (+' + result.coins + ' 코인)');
    DB.Journal.add('keeper', '양육자 레벨 ' + result.level + '이 되었어요!');
    _announceUnlocks(result.level);
    refreshHeader();
  }

  function _announceUnlocks(level) {
    Object.keys(GAME.FOOD_DEFS).forEach(function (id) {
      const def = GAME.FOOD_DEFS[id];
      if (def.unlockLevel === level) {
        Toast.show('🔓 새 먹이 해금: ' + def.emoji + ' ' + def.label + '!');
        DB.Journal.add('unlock', def.label + '을(를) 상점에서 살 수 있게 되었어요.');
      }
    });
    if (GAME.CONFIG.KEEPER_STAMINA_LEVELS.indexOf(level) !== -1) {
      Toast.show('🔓 탐험 스태미나 확장! (하루 ' + GAME.exploreMaxSearches(DB.Player.get()) + '회)');
      DB.Journal.add('unlock', '탐험을 더 오래 할 수 있게 되었어요.');
    }
  }

  /**
   * 경과 시간 정산 (미접속분 포함).
   * 1시간 단위로만 적용되며, 적용된 구간만큼만 last_seen을 전진시켜
   * 1시간 미만의 잔여 시간을 잃지 않는다.
   * @returns {boolean} 감쇠가 적용되었는지
   */
  function _settleTime() {
    const player = DB.Player.get();
    const decoFx = GAME.decorationEffects(player);
    let intervals = 0;
    const updated = DB.Snails.get().map(function (snail) {
      const result = GAME.applyTimeDecay(snail, player.last_seen, DB.now(), decoFx);
      intervals = Math.max(intervals, result.intervals);
      return result.snail;
    });

    if (intervals <= 0) return false;

    DB.Snails.save(updated);
    const advancedMs = intervals * GAME.CONFIG.DECAY_INTERVAL_MIN * 60 * 1000;
    player.last_seen = new Date(new Date(player.last_seen).getTime() + advancedMs).toISOString();
    DB.Player.save(player);
    return true;
  }

  /** 앱 사용 중에도 시간 감쇠가 반영되도록 주기 확인 */
  function _startTick() {
    if (_tickTimer) clearInterval(_tickTimer);
    _tickTimer = setInterval(function () {
      applyWeather(); // 자정을 넘기면 날씨가 바뀔 수 있다
      if (Api.enabled()) return; // 서버 모드: 감쇠는 서버 lazy 정산
      if (!_settleTime()) return;
      refreshHeader();
      if (document.getElementById('screen-home').classList.contains('active')) {
        HomeModule.render();
      }
      if (document.getElementById('screen-stats').classList.contains('active')) {
        StatsModule.render();
      }
    }, TICK_MS);
  }

  function _durationText(min) {
    if (min >= 60) return Math.floor(min / 60) + '시간 ' + (min % 60) + '분';
    return min + '분';
  }

  function _awayLines(report) {
    const lines = [];
    report.snails.forEach(function (s) {
      if (s.hunger_delta > 0) {
        lines.push(s.name + ': 배고픔 +' + s.hunger_delta +
          (s.happiness_delta < 0 ? ', 행복 ' + s.happiness_delta : ''));
      }
    });
    report.finds.forEach(function (find) {
      lines.push(find.type === 'coins'
        ? '돌아다니다 코인 ' + find.amount + '개를 주웠어요!'
        : '어디선가 상추를 하나 물어왔어요!');
    });
    if (lines.length === 0) lines.push('다들 얌전히 기다리고 있었어요.');
    return lines;
  }

  /** 부팅 시 부재 정산 (개체별 감쇠 + 계정 발견) + 복귀 리포트 표시 */
  function _settleAway() {
    const result = GAME.summarizeAway(DB.Snails.get(), DB.Player.get(), DB.now());
    DB.Snails.save(result.snails);
    DB.Player.save(result.player);

    result.report.finds.forEach(function (find) {
      DB.Journal.add('find', find.type === 'coins'
        ? '돌아다니다 코인 ' + find.amount + '개를 주워왔어요!'
        : '어디선가 상추를 하나 물어왔어요!');
    });

    if (result.report.away_minutes >= GAME.CONFIG.AWAY_REPORT_MIN) {
      Toast.report({
        emoji: '🐌',
        title: '다녀오셨어요? (' + _durationText(result.report.away_minutes) + ')',
        lines: _awayLines(result.report),
        buttonLabel: '보러 가기'
      });
    }
  }

  /** 저장된 배경을 body에 적용 */
  function applyBackground() {
    const player = DB.Player.get();
    document.body.dataset.background = player.background || 'default';
  }

  /** 오늘의 날씨를 body에 적용 (결정적 — 저장하지 않음) */
  function applyWeather() {
    document.body.dataset.weather = GAME.weatherFor(DB.today());
  }

  /**
   * 관리자 모드: URL에 ?admin=1이면 켜고(?admin=0이면 끔) 자원을 채운다.
   * 로그인이 없는 정적 앱이라 URL 파라미터로 활성화한다 — 졸업 등 실험용.
   */
  function _applyAdminFromURL() {
    const params = new URLSearchParams(location.search);
    if (!params.has('admin')) return;

    const player = DB.Player.get();
    const enable = params.get('admin') !== '0';
    player.admin = enable;
    if (enable) {
      player.coins = GAME.CONFIG.ADMIN_COINS;
      Object.keys(GAME.FOOD_DEFS).forEach(function (id) {
        player.foods[id] = GAME.CONFIG.ADMIN_FOOD;
      });
    }
    DB.Player.save(player);
    Toast.show(enable
      ? '🛠️ 관리자 모드: 코인/상추 무한, 배고픔 무시, 경험치 ×' + GAME.CONFIG.ADMIN_EXP_MULT
      : '관리자 모드 꺼짐');
  }

  /** 구버전 데이터 마이그레이션: 부화한 달팽이에게 성격 1회 소급 부여 */
  function _ensurePersonality() {
    DB.Snails.get().forEach(function (snail) {
      if (snail.stage === 'egg' || snail.personality) return;
      snail.personality = GAME.rollPersonality();
      DB.Snails.saveOne(snail);
      DB.Journal.add('personality',
        snail.name + '의 성격이 "' + GAME.PERSONALITIES[snail.personality].label + '"라는 걸 알게 됐어요.');
    });
  }

  /** 접속 보상 + 출석 스트릭 (하루 1회 자동 지급) */
  function _claimDailyReward() {
    const result = GAME.applyStreak(DB.Player.get(), DB.today());
    if (result.events.indexOf('daily_claimed') === -1) return;

    DB.Player.save(result.player);
    Sound.play('coin');
    let msg = '🎁 접속 보상 +' + result.coins + ' 코인!';
    if (result.streak > 1) msg += ' (연속 ' + result.streak + '일)';
    Toast.show(msg);
    if (result.food > 0) {
      Toast.show('🥬 ' + result.streak + '일 연속 출석! 상추 +' + result.food);
      DB.Journal.add('streak', result.streak + '일 연속으로 함께했어요.');
    }
    gainKeeperXp('daily');
  }

  function _bindNav() {
    document.querySelectorAll('.tab-bar .tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        Sound.play('tap');
        navigate(tab.dataset.screen);
      });
    });
  }

  /** 서버 모드: 위치는 주기 저장 (경제 데이터 아님) */
  function _startPositionSync() {
    setInterval(function () {
      const positions = DB.Snails.get()
        .filter(function (s) { return s.stage !== 'egg'; })
        .map(function (s) { return { id: s.id, rx: s.pos.rx, ry: s.pos.ry }; });
      if (positions.length) Api.syncPosition(positions).catch(function () { /* 무시 */ });
    }, 60 * 1000);
  }

  async function init() {
    // 첫 실행이면 기본값(알 + 시작 자원)이 생성된다 (로컬 미러)
    DB.Player.get();
    DB.Snails.get();

    _bindNav();
    HomeModule.bind();
    StatsModule.bind();
    ShopModule.bind();
    DecoModule.bind();
    ExploreModule.bind();
    SettingsModule.bind();
    SettingsModule.render();

    let serverReady = false;
    if (Api.enabled()) {
      // 서버 모드: 정산/보상/판정은 전부 서버 — 로컬 정산 경로를 타지 않는다
      try {
        await Api.ensureAuth();
        let state = await Api.state();
        state = await Api.Net.maybeOfferMigration(state);
        Api.Net.apply(state);
        _startPositionSync();
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) Api.state().then(Api.Net.apply).catch(function () { /* 무시 */ });
        });
        serverReady = true;
      } catch (e) {
        // 죽은 주소/오프라인 → 이번 세션은 로컬 모드로 완전 폴백 (반쪽 상태 방지)
        Api.disableForSession();
        Toast.show('서버(' + Api.base() + ')에 연결할 수 없어 로컬 모드로 실행해요. 이 동안의 진행은 서버에 저장되지 않아요.', 'warn');
      }
    }
    if (!serverReady) {
      _applyAdminFromURL();
      _ensurePersonality();
      _settleAway();
      _claimDailyReward();
      DecoModule.claimUnlocks();
    }

    applyBackground();
    applyWeather();
    refreshHeader();
    navigate('home');
    HabitatModule.init();
    _startTick();
  }

  /** PWA 서비스 워커 등록 (지원 환경에서만 — 실패해도 게임은 정상 동작) */
  function _registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').catch(function () {
      /* file:// 등 미지원 환경 무시 */
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    init();
    _registerServiceWorker();
  });

  return {
    navigate: navigate,
    refreshHeader: refreshHeader,
    gainKeeperXp: gainKeeperXp,
    applyBackground: applyBackground
  };
})();
