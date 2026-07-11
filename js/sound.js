/**
 * Sound — Web Audio 합성 효과음 (외부 파일 없음)
 * 전역 네임스페이스: Sound
 *
 * AudioContext는 첫 재생 시점에 생성한다 (브라우저 자동재생 정책).
 * 설정의 효과음 토글(sn_player.sound_on)이 꺼져 있으면 완전 무음.
 * 사운드 실패는 게임 진행을 절대 막지 않는다.
 */
const Sound = (function () {
  'use strict';

  let _ctx = null;

  function _enabled() {
    return DB.Player.get().sound_on !== false;
  }

  function _audioCtx() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null; // 미지원 환경(테스트 등)에서는 조용히 무시
    if (!_ctx) _ctx = new Ctor();
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  /** 단일 톤 (주파수 슬라이드 + 짧은 엔벨로프) */
  function _tone(ctx, opts) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + (opts.delay || 0);
    const dur = opts.duration;

    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.from, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.volume || 0.08, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 짧은 노이즈 버스트 (아삭 — 먹기) */
  function _crunch(ctx) {
    const dur = 0.09;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    const gain = ctx.createGain();
    gain.gain.value = 0.12;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  }

  const SOUNDS = {
    // 뽁 — 버튼/탭 전환
    tap: function (ctx) {
      _tone(ctx, { from: 220, to: 180, duration: 0.06, type: 'sine', volume: 0.05 });
    },
    // 띠링 — 코인 획득
    coin: function (ctx) {
      _tone(ctx, { from: 880, duration: 0.07, type: 'sine' });
      _tone(ctx, { from: 1320, duration: 0.1, type: 'sine', delay: 0.07 });
    },
    // 아삭 — 먹기 완료
    eat: _crunch,
    // 하트 — 쓰다듬기
    heart: function (ctx) {
      _tone(ctx, { from: 660, to: 720, duration: 0.09, type: 'triangle', volume: 0.06 });
    },
    // 팡파레 — 레벨업/부화/단계 변화/여행
    fanfare: function (ctx) {
      _tone(ctx, { from: 523, duration: 0.12, type: 'triangle' });
      _tone(ctx, { from: 659, duration: 0.12, type: 'triangle', delay: 0.12 });
      _tone(ctx, { from: 784, duration: 0.3, type: 'triangle', delay: 0.24 });
    }
  };

  function play(name) {
    try {
      if (!_enabled() || !SOUNDS[name]) return;
      const ctx = _audioCtx();
      if (!ctx) return;
      SOUNDS[name](ctx);
    } catch (e) {
      /* 사운드 실패는 무시 */
    }
  }

  /** 진동 (지원 기기에서만 — iOS Safari는 미지원이라 조용히 건너뜀) */
  function vibrate(ms) {
    try {
      if (!_enabled()) return;
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {
      /* 무시 */
    }
  }

  return { play: play, vibrate: vibrate };
})();
