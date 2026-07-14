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
    if (screen === 'user' && typeof StatsModule !== 'undefined') StatsModule.render();
    if (screen === 'dex' && typeof DexModule !== 'undefined') DexModule.render();
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
      if (document.getElementById('screen-user').classList.contains('active')) {
        StatsModule.render();
      }
      if (document.getElementById('screen-dex').classList.contains('active')) {
        DexModule.render();
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

    // 부재 중 생활 시뮬 — "살아 있었다는 증거" (11차 §5)
    const life = GAME.simulateAwayLife(result.snails, result.player,
      result.report.away_minutes, DB.today());
    _recordLifeJournal(life.lines);

    result.report.finds.forEach(function (find) {
      DB.Journal.add('find', find.type === 'coins'
        ? '돌아다니다 코인 ' + find.amount + '개를 주워왔어요!'
        : '어디선가 상추를 하나 물어왔어요!');
    });

    if (result.report.away_minutes >= GAME.CONFIG.AWAY_REPORT_MIN) {
      Toast.report({
        emoji: '🐌',
        title: '다녀오셨어요? (' + _durationText(result.report.away_minutes) + ')',
        lines: life.lines.concat(_awayLines(result.report)),
        buttonLabel: '보러 가기'
      });
    }
    _applySceneLater(life.scene);
  }

  /** 생활 문장을 성장 일지에 기록 — 하루 최대 2건 (스팸 가드) */
  function _recordLifeJournal(lines) {
    if (!lines || !lines.length) return;
    const player = DB.Player.get();
    const today = DB.today();
    const used = (player.last_life_journal_date === today) ? (player.last_life_journal_count || 0) : 0;
    const room = Math.max(0, 2 - used);
    for (let i = 0; i < Math.min(room, lines.length); i++) DB.Journal.add('life', lines[i]);
    player.last_life_journal_date = today;
    player.last_life_journal_count = used + Math.min(room, lines.length);
    DB.Player.save(player);
  }

  /** 복귀 장면은 서식지 준비 후 배치 (문장과 화면 일치) */
  function _applySceneLater(scene) {
    if (!scene || !scene.length) return;
    setTimeout(function () {
      try { HabitatModule.applyScene(scene); } catch (e) { /* 서식지 미준비 시 무시 */ }
    }, 200);
  }

  /** 서버 모드 복귀 처리 — 미러 상태로 생활 시뮬 후 일지/장면 반영, 문장 반환 */
  function showAwayLife(minutes) {
    const life = GAME.simulateAwayLife(DB.Snails.get(), DB.Player.get(), minutes, DB.today());
    _recordLifeJournal(life.lines);
    if (life.lines.length) StatsModule.render();
    _applySceneLater(life.scene);
    return life.lines;
  }

  /** 저장된 배경을 body에 적용 — 은퇴/무효 배경(garden 등)은 default로 표시 */
  function applyBackground() {
    const player = DB.Player.get();
    const bg = player.background;
    document.body.dataset.background =
      (bg === 'default' || bg === 'pond' || bg === 'fern') ? bg : 'default';
  }

  /** 현재 슬롯(낮/밤)의 날씨를 body에 적용 (결정적 — 저장하지 않음) */
  function applyWeather() {
    const hour = new Date().getHours();
    const today = DB.today();
    const current = GAME.weatherFor(today, hour);
    document.body.dataset.weather = current;

    // 비 갠 직후 무지개 — 슬롯 전환 첫 1시간(06시/18시대), 이전 슬롯이 비였고 지금 맑음
    let rainbow = false;
    if (current === 'sunny' && (hour === 6 || hour === 18)) {
      rainbow = GAME.weatherFor(today, hour - 1) === 'rain';
    }
    document.body.dataset.rainbow = rainbow ? '1' : '0';
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
    // 홈 우측 상단 설정 아이콘 → 설정 화면 (탭바에서 빠짐)
    const settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function () {
        Sound.play('tap');
        navigate('settings');
      });
    }
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

  /** 밤낮 리듬 — body[data-daytime]로 CSS 오버레이 제어 (22~07시=밤) */
  function _updateDaytime() {
    const h = new Date().getHours();
    document.body.dataset.daytime = (h >= 22 || h < 7) ? 'night' : 'day';
  }

  async function init() {
    // 첫 실행이면 기본값(알 + 시작 자원)이 생성된다 (로컬 미러)
    DB.Player.get();
    DB.Snails.get();

    _updateDaytime();
    setInterval(_updateDaytime, 60000);

    _bindNav();
    HomeModule.bind();
    StatsModule.bind();
    ShopModule.bind();
    DecoModule.bind();
    ExploreModule.bind();
    RaceModule.bind();
    QuizModule.bind();
    ShareModule.bind();
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
        Api.flushQueue(); // 지난 세션에 밀린 오프라인 행동 재전송
        loadNotices();    // 공지 배너 / urgent 모달
        _startPositionSync();
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) {
            Api.flushQueue();
            Api.refreshFromServer().catch(function () { /* 무시 */ });
          }
        });
        window.addEventListener('online', function () { Api.flushQueue(); });
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
    // 새 버전 SW가 활성화되면(controllerchange) 1회 새로고침 —
    // 옛 캐시로 그려진 화면(css/js)과 새 자산이 섞여 "업데이트가 적용 안 됨"으로 보이는 문제 방지
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    init();
    _registerServiceWorker();
  });

  // ── 파비콘: 현재 키우는 대표 달팽이로 동적 반영 ────────
  // 부화하면 그 달팽이(변이색)로, 자라서 외형이 바뀌면 자란 버전으로 탭 아이콘이 바뀐다.
  function updateFavicon() {
    const link = document.querySelector('link[rel="icon"]');
    if (!link) return;
    const snails = DB.Snails.get();
    const hatched = snails.filter(function (s) { return s.stage !== 'egg'; });
    const rep = hatched[0] || snails[0];
    const href = (!rep || rep.stage === 'egg')
      ? 'assets/characters/egg.png'
      : GAME.spritePath(rep.color, GAME.displayStage(rep));
    if (link.getAttribute('href') !== href) {
      link.setAttribute('type', 'image/png');
      link.setAttribute('href', href);
    }
  }

  // ── 라이브 이벤트 / 공지 배너 (서버 모드) ──────────────
  let _liveEvents = [];
  let _notices = [];

  function setLiveEvents(events) {
    _liveEvents = events || [];
    renderLiveBanner();
  }

  function renderLiveBanner() {
    const el = document.getElementById('live-banner');
    if (!el) return;
    const items = [];
    _liveEvents.forEach(function (e) { items.push('🌟 ' + e.title); });
    _notices.filter(function (n) { return n.priority !== 'urgent'; })
      .forEach(function (n) { items.push('📢 ' + n.title); });
    if (items.length === 0) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = items.join('   ·   ');
  }

  function loadNotices() {
    if (!Api.enabled()) return;
    Api.notices().then(function (res) {
      _notices = res.notices || [];
      renderLiveBanner();
      _showUrgentNotice();
    }).catch(function () { /* 무시 */ });
  }

  /** urgent 공지는 부팅 시 모달 1회 (읽음은 로컬 저장) */
  function _showUrgentNotice() {
    let read;
    try { read = JSON.parse(localStorage.getItem('sn_read_notices') || '[]'); }
    catch (e) { read = []; }
    const urgent = _notices.find(function (n) {
      return n.priority === 'urgent' && read.indexOf(n.id) === -1;
    });
    if (!urgent) return;
    Toast.confirm({
      title: '📢 ' + urgent.title,
      message: urgent.body || '',
      confirmLabel: '확인',
      confirmClass: 'btn-primary',
      onConfirm: function () {
        read.push(urgent.id);
        localStorage.setItem('sn_read_notices', JSON.stringify(read));
      }
    });
  }

  /**
   * 도감 등급 완성 보상 정산 (로컬 모드) — 방금 완성된 등급마다 코인을 1회 지급한다.
   * 서버 모드는 서버가 부화 시 우편함으로 지급하므로 건너뛴다.
   * @returns {boolean} 하나라도 지급했는지
   */
  function checkDexRewards() {
    if (Api.enabled()) return false;
    const player = DB.Player.get();
    const discovered = GAME.discoveredVariants(DB.Album.get(), DB.Snails.get());
    const claims = GAME.dexRewardsToClaim(discovered, player.dex_claimed || []);
    if (claims.length === 0) return false;

    claims.forEach(function (c) {
      player.coins += c.coins;
      player.dex_claimed = (player.dex_claimed || []).concat(c.tier);
      const tierLabel = (GAME.RARITIES[c.tier] || { label: c.tier }).label;
      Sound.play('fanfare');
      FX.confetti(16);
      Toast.show('🏅 ' + tierLabel + ' 도감 완성! (+' + c.coins + ' 코인)');
      DB.Journal.add('dex', tierLabel + ' 등급 도감을 완성했어요! (+' + c.coins + ' 코인)');
    });
    DB.Player.save(player);
    refreshHeader();
    return true;
  }

  return {
    navigate: navigate,
    refreshHeader: refreshHeader,
    gainKeeperXp: gainKeeperXp,
    checkDexRewards: checkDexRewards,
    applyBackground: applyBackground,
    setLiveEvents: setLiveEvents,
    loadNotices: loadNotices,
    updateFavicon: updateFavicon,
    showAwayLife: showAwayLife
  };
})();
