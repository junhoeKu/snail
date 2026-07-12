/**
 * Api — 서버 권위형 백엔드 어댑터 (듀얼 모드)
 * 전역 네임스페이스: Api
 *
 * index.html의 window.SNAIL_API_BASE가 비어 있으면 완전히 비활성(기존 LocalStorage 모드).
 * 서버 모드에서 LocalStorage는 렌더링용 미러 캐시가 되고, 판정은 전부 서버가 한다.
 * 토큰 저장은 인증 계층이므로 DB 모듈 경유 규칙의 예외로 localStorage를 직접 쓴다.
 */
const Api = (function () {
  'use strict';

  const BASE = String(window.SNAIL_API_BASE || '').replace(/\/+$/, '');
  const TOKEN_KEY = 'sn_access_token';
  const REFRESH_KEY = 'sn_refresh_token';

  function enabled() {
    return BASE.length > 0;
  }

  function requestId() {
    return (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // ── 토큰 ──────────────────────────────────────────────

  function _tokens() {
    return {
      access: localStorage.getItem(TOKEN_KEY),
      refresh: localStorage.getItem(REFRESH_KEY)
    };
  }

  function _saveTokens(pair) {
    localStorage.setItem(TOKEN_KEY, pair.accessToken);
    localStorage.setItem(REFRESH_KEY, pair.refreshToken);
  }

  async function _guest() {
    const res = await fetch(BASE + '/v1/auth/guest', { method: 'POST' });
    if (!res.ok) throw { code: 'auth_failed' };
    _saveTokens(await res.json());
  }

  async function _refresh() {
    const refresh = _tokens().refresh;
    if (!refresh) return _guest();
    const res = await fetch(BASE + '/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh })
    });
    if (!res.ok) return _guest(); // 세션 만료 → 새 게스트 (데이터는 서버 계정별 — 토큰 유실 시 안내는 QA 이후 과제)
    _saveTokens(await res.json());
  }

  async function ensureAuth() {
    if (!_tokens().access) await _refresh();
  }

  // ── 요청 공통 (401 → 1회 갱신 재시도) ─────────────────

  async function _request(method, path, body, canRetry) {
    let res;
    try {
      res = await fetch(BASE + path, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (_tokens().access || '')
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      throw { code: 'network', message: '네트워크에 연결할 수 없어요.' };
    }

    if (res.status === 401 && canRetry !== false) {
      await _refresh();
      return _request(method, path, body, false);
    }
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw (data && data.error) || { code: 'server_error', message: '서버 오류가 발생했어요.' };
    }
    return data;
  }

  // ── 엔드포인트 ────────────────────────────────────────

  const endpoints = {
    state: function () { return _request('GET', '/v1/game/state'); },
    config: function () { return _request('GET', '/v1/game/config'); },
    feed: function (snailId, foodId) {
      return _request('POST', '/v1/snails/' + snailId + '/feed', { foodId: foodId, requestId: requestId() });
    },
    pet: function (snailId) {
      return _request('POST', '/v1/snails/' + snailId + '/pet', { requestId: requestId() });
    },
    hatch: function (snailId, name) {
      return _request('POST', '/v1/snails/' + snailId + '/hatch', { name: name, requestId: requestId() });
    },
    graduate: function (snailId) {
      return _request('POST', '/v1/snails/' + snailId + '/graduate', { requestId: requestId() });
    },
    purchase: function (kind, itemId, count) {
      return _request('POST', '/v1/shop/purchase', { kind: kind, itemId: itemId || null, count: count || 1, requestId: requestId() });
    },
    explore: function (mapId) {
      return _request('POST', '/v1/explorations/search', { mapId: mapId, requestId: requestId() });
    },
    setDecoSlots: function (slots) {
      return _request('POST', '/v1/decorations/slots', { slots: slots });
    },
    syncPosition: function (positions) {
      return _request('POST', '/v1/game/sync-position', { positions: positions });
    },
    updateSettings: function (patch) {
      return _request('PATCH', '/v1/game/settings', patch);
    },
    migrate: function (payload) {
      return _request('POST', '/v1/migrations/local-v6', payload);
    }
  };

  // ── Net — 서버 응답을 로컬 미러/UI에 반영 ─────────────

  const Net = {
    /** 상태/행동 응답 공통 반영: 미러 갱신 → 렌더 → 이벤트 연출 */
    apply: function (result) {
      if (result.changes) {
        if (result.changes.player) localStorage.setItem('sn_player', JSON.stringify(result.changes.player));
        if (result.changes.snails) localStorage.setItem('sn_snails', JSON.stringify(result.changes.snails));
      }
      if (result.album) localStorage.setItem('sn_album', JSON.stringify(result.album));
      if (result.journal) localStorage.setItem('sn_journal', JSON.stringify(result.journal));

      App.refreshHeader();
      App.applyBackground();
      HomeModule.render();
      StatsModule.render();
      Net.playEvents(result.events || []);
      return result;
    },

    /** 서버 events → 기존 연출 파이프라인 재생 */
    playEvents: function (events) {
      const findSnail = function (id) {
        return DB.Snails.getById(id) || { name: '' };
      };
      events.forEach(function (e) {
        switch (e.type) {
          case 'daily_claimed':
            Sound.play('coin');
            Toast.show('🎁 접속 보상 +' + e.coins + ' 코인!' + (e.streak > 1 ? ' (연속 ' + e.streak + '일)' : ''));
            break;
          case 'found_item':
            Toast.show(e.type === 'coins' || e.amount > 1
              ? '🧺 달팽이가 뭔가 주워왔어요! (+' + e.amount + (e.type === 'coins' ? ' 코인' : ' 상추') + ')'
              : '🧺 달팽이가 상추를 물어왔어요!');
            break;
          case 'fed':
            Toast.show('냠냠! ' + findSnail(e.snailId).name + ' 맛있게 먹었어요 (+' + e.exp + ' EXP)');
            break;
          case 'levelup':
            Sound.play('fanfare');
            Toast.show('🎉 ' + findSnail(e.snailId).name + ' 레벨 업! Lv.' + e.level);
            break;
          case 'stage_up':
            FX.confetti(14);
            Toast.celebrate({
              emoji: '🐌',
              title: findSnail(e.snailId).name + ' — 성장!',
              message: e.stage === 'junior' ? '껍질이 커졌습니다!' : '어엿한 성체가 되었습니다!'
            });
            break;
          case 'hatched':
            Sound.play('fanfare');
            Sound.vibrate(30);
            FX.confetti(16);
            Toast.celebrate({
              emoji: e.color === 'golden' ? '✨' : '🐌',
              title: '부화 성공!',
              message: findSnail(e.snailId).name + '(이)가 태어났어요. 잘 돌봐주세요!'
            });
            break;
          case 'dex_new':
            Toast.show('📖 도감에 새 변이가 등록됐어요!');
            break;
          case 'graduated':
            Sound.play('fanfare');
            FX.confetti(16);
            Toast.celebrate({
              emoji: '🧳',
              title: '잘 다녀와, ' + e.name + '!',
              message: '추억은 앨범에 남았어요. 새 알이 도착했어요!'
            });
            break;
          case 'mission_done':
            Sound.play('coin');
            Toast.show('✅ 미션 완료! (+' + e.coins + ' 코인)');
            break;
          case 'mission_all_done':
            Toast.show('🎉 오늘의 돌봄 완주! +' + e.coins + ' 코인, 상추 +' + e.food);
            break;
          case 'keeper_levelup':
            Sound.play('fanfare');
            FX.confetti(12);
            Toast.show('🧑‍🌾 양육자 레벨 업! Lv.' + e.level + ' (+' + e.coins + ' 코인)');
            break;
          case 'deco_unlocked':
            Toast.show('🎉 장식 해금! 상점에서 배치할 수 있어요.');
            break;
          case 'wild_egg':
            FX.confetti(14);
            Toast.celebrate({ emoji: '🥚', title: '야생 알 발견!', message: '서식지로 데려왔어요. 터치해 이름을 지어주세요.' });
            break;
          case 'wild_egg_converted':
            Toast.show('🥚 보금자리가 가득해 코인 ' + e.coins + '개로 바꿨어요.', 'warn');
            break;
          case 'map_unlocked':
            Sound.play('fanfare');
            Toast.show('🗺️ 새 탐험 맵 해금!');
            break;
          case 'food_bought':
            Sound.play('coin');
            break;
          case 'away_report':
            Toast.show('🐌 다녀오셨어요? (' + Math.floor(e.minutes / 60) + '시간 ' + (e.minutes % 60) + '분)');
            break;
        }
      });
    },

    /** 실패 공통: 안내 후 서버 상태로 재동기화 */
    fail: function (error) {
      const messages = {
        network: '네트워크에 연결할 수 없어요. 잠시 후 다시 시도해주세요.',
        no_food: '선택한 먹이가 없어요. 상점에서 구매하세요!',
        not_hungry: '지금은 배고프지 않아요.',
        not_enough_coins: '코인이 부족해요.',
        no_stamina: '오늘은 더 뒤질 힘이 없어요.',
        food_locked: '아직 잠긴 먹이예요. 양육자 레벨을 올려보세요!',
        max_slots: '보금자리가 가득해요.',
        cannot_graduate: '성체 Lv.12부터 여행을 보낼 수 있어요.',
        social_conflict: '이미 다른 계정에 연결된 소셜 계정입니다.'
      };
      Toast.show(messages[error && error.code] || (error && error.message) || '요청을 처리하지 못했어요.', 'warn');
      if (error && error.code !== 'network') {
        endpoints.state().then(Net.apply).catch(function () { /* 재동기화 실패는 무시 */ });
      }
    },

    /**
     * 서버가 비어 있고 로컬에 진행 데이터가 있으면 이전 제안.
     * ⚠️ 이후 Net.apply가 로컬 미러를 서버 상태로 덮어쓰므로,
     *    이전에 보낼 데이터는 지금 이 시점에 스냅샷으로 캡처한다.
     */
    maybeOfferMigration: function (state) {
      const player = state.changes && state.changes.player;
      if (!player || player.migration_done) return Promise.resolve(state);

      const dump = {
        schemaVersion: 6,
        player: JSON.parse(localStorage.getItem('sn_player') || '{}'),
        snails: JSON.parse(localStorage.getItem('sn_snails') || '[]'),
        album: JSON.parse(localStorage.getItem('sn_album') || '[]'),
        journal: JSON.parse(localStorage.getItem('sn_journal') || '[]')
      };
      const hasLocal = dump.snails.some(function (s) { return s.stage !== 'egg'; });
      const serverFresh = (state.changes.snails || []).every(function (s) { return s.stage === 'egg'; });
      if (!hasLocal || !serverFresh) return Promise.resolve(state);

      Toast.confirm({
        title: '기존 데이터 이전',
        message: '이 기기에 저장된 달팽이 데이터를 서버 계정으로 옮길까요? (한 번만 가능)',
        confirmLabel: '이전하기',
        confirmClass: 'btn-primary',
        onConfirm: function () {
          endpoints.migrate(dump)
            .then(function (result) {
              Toast.show('✅ 서버로 안전하게 이전했어요!');
              Net.apply(result);
              HabitatModule.sync();
            })
            .catch(Net.fail);
        }
      });
      return Promise.resolve(state); // 모달과 무관하게 부팅은 진행
    }
  };

  return {
    enabled: enabled,
    ensureAuth: ensureAuth,
    requestId: requestId,
    state: endpoints.state,
    config: endpoints.config,
    feed: endpoints.feed,
    pet: endpoints.pet,
    hatch: endpoints.hatch,
    graduate: endpoints.graduate,
    purchase: endpoints.purchase,
    explore: endpoints.explore,
    setDecoSlots: endpoints.setDecoSlots,
    syncPosition: endpoints.syncPosition,
    updateSettings: endpoints.updateSettings,
    migrate: endpoints.migrate,
    Net: Net
  };
})();
