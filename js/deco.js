/**
 * DecoModule — 꾸미기 화면 (서식지 배경 선택)
 * 전역 네임스페이스: DecoModule
 */
const DecoModule = (function () {
  'use strict';

  function render() {
    const player = DB.Player.get();
    document.querySelectorAll('.bg-option').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.bg === player.background);
    });
  }

  function _setBackground(bg) {
    const player = DB.Player.get();
    if (player.background === bg) return;

    player.background = bg;
    DB.Player.save(player);
    App.applyBackground();
    render();
    Toast.show('배경을 바꿨어요!');
  }

  function bind() {
    document.querySelectorAll('.bg-option').forEach(function (el) {
      el.addEventListener('click', function () {
        _setBackground(el.dataset.bg);
      });
    });
  }

  return { render: render, bind: bind };
})();
