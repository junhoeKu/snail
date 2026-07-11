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

  /**
   * 리포트 모달 — 복귀 요약 등 여러 줄 안내
   * @param {{emoji: string, title: string, lines: string[], buttonLabel: string}} opts
   */
  function report(opts) {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal-box';

    const emoji = document.createElement('div');
    emoji.className = 'modal-emoji';
    emoji.textContent = opts.emoji || '🐌';

    const title = document.createElement('h3');
    title.textContent = opts.title || '';

    const list = document.createElement('ul');
    list.className = 'report-lines';
    (opts.lines || []).forEach(function (line) {
      const li = document.createElement('li');
      li.textContent = line;
      list.appendChild(li);
    });

    const btn = document.createElement('button');
    btn.className = 'btn btn-primary btn-wide';
    btn.textContent = opts.buttonLabel || '확인';
    btn.addEventListener('click', function () { overlay.remove(); });

    box.appendChild(emoji);
    box.appendChild(title);
    box.appendChild(list);
    box.appendChild(btn);
    overlay.appendChild(box);
    root.appendChild(overlay);
  }

  /**
   * 확인 모달 — 되돌릴 수 없는 동작(초기화 등) 전 2단계 확인
   * @param {{title: string, message: string, confirmLabel: string, onConfirm: Function}} opts
   */
  function confirm(opts) {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal-box';

    const title = document.createElement('h3');
    title.textContent = opts.title || '확인';

    const message = document.createElement('p');
    message.textContent = opts.message || '';

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = '취소';
    cancelBtn.addEventListener('click', function () { overlay.remove(); });

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn ' + (opts.confirmClass || 'btn-danger');
    confirmBtn.textContent = opts.confirmLabel || '확인';
    confirmBtn.addEventListener('click', function () {
      overlay.remove();
      if (typeof opts.onConfirm === 'function') opts.onConfirm();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    box.appendChild(title);
    box.appendChild(message);
    box.appendChild(actions);
    overlay.appendChild(box);
    root.appendChild(overlay);
  }

  return { show: show, celebrate: celebrate, report: report, confirm: confirm };
})();
