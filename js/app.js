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
    if (screen === 'deco' && typeof DecoModule !== 'undefined') DecoModule.render();

    // 홈에서만 서식지 게임 루프를 돌린다
    if (typeof HabitatModule !== 'undefined') {
      if (screen === 'home') HabitatModule.resume();
      else HabitatModule.pause();
    }
  }

  /** 지갑(코인/상추) 표시 갱신 */
  function refreshHeader() {
    const player = DB.Player.get();
    document.getElementById('coin-count').textContent = player.coins;
    document.getElementById('food-count').textContent = player.food;
  }

  /**
   * 경과 시간 정산 (미접속분 포함).
   * 1시간 단위로만 적용되며, 적용된 구간만큼만 last_seen을 전진시켜
   * 1시간 미만의 잔여 시간을 잃지 않는다.
   * @returns {boolean} 감쇠가 적용되었는지
   */
  function _settleTime() {
    const player = DB.Player.get();
    const snail = DB.Snail.get();
    const result = GAME.applyTimeDecay(snail, player.last_seen, DB.now());

    if (result.intervals <= 0) return false;

    DB.Snail.save(result.snail);
    const advancedMs = result.intervals * GAME.CONFIG.DECAY_INTERVAL_MIN * 60 * 1000;
    player.last_seen = new Date(new Date(player.last_seen).getTime() + advancedMs).toISOString();
    DB.Player.save(player);
    return true;
  }

  /** 앱 사용 중에도 시간 감쇠가 반영되도록 주기 확인 */
  function _startTick() {
    if (_tickTimer) clearInterval(_tickTimer);
    _tickTimer = setInterval(function () {
      applyWeather(); // 자정을 넘기면 날씨가 바뀔 수 있다
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
    if (report.hunger_delta > 0) lines.push('배고픔이 ' + report.hunger_delta + ' 올랐어요.');
    if (report.happiness_delta < 0) lines.push('조금 심심했나 봐요. (행복 ' + report.happiness_delta + ')');
    report.finds.forEach(function (find) {
      lines.push(find.type === 'coins'
        ? '산책하다 코인 ' + find.amount + '개를 주웠어요!'
        : '어디선가 상추를 하나 물어왔어요!');
    });
    if (lines.length === 0) lines.push('얌전히 기다리고 있었어요.');
    return lines;
  }

  /** 부팅 시 부재 정산 (감쇠 + 발견) + 복귀 리포트 표시 */
  function _settleAway() {
    const result = GAME.summarizeAway(DB.Snail.get(), DB.Player.get(), DB.now());
    DB.Snail.save(result.snail);
    DB.Player.save(result.player);

    result.report.finds.forEach(function (find) {
      DB.Journal.add('find', find.type === 'coins'
        ? '산책하다 코인 ' + find.amount + '개를 주워왔어요!'
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

  /** v2 데이터 마이그레이션: 기존 달팽이에게 성격 1회 소급 부여 */
  function _ensurePersonality() {
    const snail = DB.Snail.get();
    if (snail.stage === 'egg' || snail.personality) return;
    snail.personality = GAME.rollPersonality();
    DB.Snail.save(snail);
    DB.Journal.add('personality',
      snail.name + '의 성격이 "' + GAME.PERSONALITIES[snail.personality].label + '"라는 걸 알게 됐어요.');
  }

  /** 접속 보상 + 출석 스트릭 (하루 1회 자동 지급) */
  function _claimDailyReward() {
    const result = GAME.applyStreak(DB.Player.get(), DB.today());
    if (result.events.indexOf('daily_claimed') === -1) return;

    DB.Player.save(result.player);
    let msg = '🎁 접속 보상 +' + result.coins + ' 코인!';
    if (result.streak > 1) msg += ' (연속 ' + result.streak + '일)';
    Toast.show(msg);
    if (result.food > 0) {
      Toast.show('🥬 ' + result.streak + '일 연속 출석! 상추 +' + result.food);
      DB.Journal.add('streak', result.streak + '일 연속으로 함께했어요.');
    }
  }

  function _bindNav() {
    document.querySelectorAll('.tab-bar .tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        navigate(tab.dataset.screen);
      });
    });
  }

  function init() {
    // 첫 실행이면 기본값(알 + 시작 자원)이 생성된다
    DB.Player.get();
    DB.Snail.get();

    _bindNav();
    HomeModule.bind();
    StatsModule.bind();
    ShopModule.bind();
    DecoModule.bind();
    SettingsModule.bind();
    SettingsModule.render();

    _ensurePersonality();
    _settleAway();
    _claimDailyReward();
    applyBackground();
    applyWeather();
    refreshHeader();
    navigate('home');
    HabitatModule.init();
    _startTick();
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    navigate: navigate,
    refreshHeader: refreshHeader,
    applyBackground: applyBackground
  };
})();
