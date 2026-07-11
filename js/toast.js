/**
 * Toast — 토스트 알림 + 축하 모달(성장 연출)
 * 전역 네임스페이스: Toast
 */
const Toast = (function () {
  'use strict';

  const DURATION_MS = 2400;

  /**
   * 하단 토스트 표시
   * @param {string} message
   * @param {string} [type] 'info' | 'warn'
   */
  function show(message, type) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = message;
    container.appendChild(el);

    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 300);
    }, DURATION_MS);
  }

  /**
   * 축하 모달 (부화/레벨업/단계 변화 연출)
   * @param {{emoji: string, title: string, message: string}} opts
   */
  function celebrate(opts) {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal-box celebrate';

    const emoji = document.createElement('div');
    emoji.className = 'modal-emoji';
    emoji.textContent = opts.emoji || '🎉';

    const title = document.createElement('h3');
    title.textContent = opts.title || '';

    const message = document.createElement('p');
    message.textContent = opts.message || '';

    const btn = document.createElement('button');
    btn.className = 'btn btn-primary btn-wide';
    btn.textContent = '확인';
    btn.addEventListener('click', function () { overlay.remove(); });

    box.appendChild(emoji);
    box.appendChild(title);
    box.appendChild(message);
    box.appendChild(btn);
    overlay.appendChild(box);
    root.appendChild(overlay);
  }

  return { show: show, celebrate: celebrate };
})();
