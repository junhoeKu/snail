/**
 * FX — 게임필 연출 (지갑 펄스/델타, 코인 플라이, 컨페티)
 * 전역 네임스페이스: FX
 *
 * prefers-reduced-motion 설정 시 모든 연출을 건너뛴다.
 * 숫자는 항상 동기적으로 반영한다 (연출은 덧입힐 뿐 상태를 지연시키지 않는다).
 */
const FX = (function () {
  'use strict';

  function _reduced() {
    return window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** 지갑 등 숫자 갱신: 즉시 반영 + 펄스 + "+N" 델타 칩 */
  function bumpNumber(el, value) {
    const from = parseInt(el.textContent, 10);
    el.textContent = value;
    if (_reduced() || isNaN(from) || value === from) return;

    const chip = el.closest('.chip');
    if (chip) {
      chip.classList.remove('fx-pulse');
      void chip.offsetWidth; // 애니메이션 재시작
      chip.classList.add('fx-pulse');
    }
    _delta(el, value - from);
  }

  function _delta(el, diff) {
    const rect = el.getBoundingClientRect();
    const chip = document.createElement('div');
    chip.className = 'fx-delta ' + (diff > 0 ? 'gain' : 'loss');
    chip.textContent = (diff > 0 ? '+' : '') + diff;
    chip.style.left = (rect.left + rect.width / 2) + 'px';
    chip.style.top = (rect.bottom + 4) + 'px';
    document.body.appendChild(chip);
    setTimeout(function () { chip.remove(); }, 900);
  }

  /** 코인 플라이: 발생 지점(뷰포트 좌표) → 지갑으로 곡선 비행 */
  function flyCoins(fromX, fromY, count) {
    if (_reduced()) return;
    const target = document.getElementById('coin-count');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const n = Math.max(1, Math.min(count || 2, 4));

    for (let i = 0; i < n; i++) {
      const coin = document.createElement('i');
      coin.className = 'fa-solid fa-coins fx-coin';
      coin.style.left = fromX + 'px';
      coin.style.top = fromY + 'px';
      document.body.appendChild(coin);

      if (typeof coin.animate !== 'function') {
        coin.remove();
        continue;
      }
      const dx = rect.left + rect.width / 2 - fromX;
      const dy = rect.top + rect.height / 2 - fromY;
      const flight = coin.animate([
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: 'translate(' + (dx * 0.5) + 'px, ' + (dy * 0.5 - 46) + 'px) scale(1.15)', offset: 0.55 },
        { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(0.45)', opacity: 0.35 }
      ], { duration: 550 + i * 90, easing: 'ease-in-out' });
      flight.onfinish = function () { coin.remove(); };
    }
  }

  /** 컨페티 — 부화/단계 변화/여행 보내기 */
  function confetti(count) {
    if (_reduced()) return;
    const colors = ['#d9a0b4', '#e8c95c', '#8fa878', '#7d97ad', '#d2a437'];
    const n = count || 14;

    for (let i = 0; i < n; i++) {
      const piece = document.createElement('div');
      piece.className = 'fx-confetti';
      piece.style.background = colors[i % colors.length];
      piece.style.left = (18 + Math.random() * 64) + 'vw';
      piece.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
      piece.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      piece.style.animationDelay = (Math.random() * 0.25) + 's';
      document.body.appendChild(piece);
      setTimeout(function () { piece.remove(); }, 1900);
    }
  }

  return { bumpNumber: bumpNumber, flyCoins: flyCoins, confetti: confetti };
})();
