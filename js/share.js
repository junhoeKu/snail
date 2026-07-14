/**
 * ShareModule — 디오라마 공유 카드 (13차 §B.1)
 * 전역 네임스페이스: ShareModule
 * 현재 서식지를 canvas로 그려 이미지로 저장/공유한다. 외부 라이브러리 없이 PNG 스프라이트를 직접 draw.
 */
const ShareModule = (function () {
  'use strict';

  const W = 640, H = 800;

  function _loadImage(src) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  async function makeCard() {
    Toast.show('🖼️ 카드를 만드는 중...');
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // 배경
    const player = DB.Player.get();
    const bgFile = player.background === 'garden' ? 'bg_garden.jpg' : 'bg_moss.jpg';
    const bg = await _loadImage('assets/backgrounds/' + bgFile);
    if (bg) {
      // cover 방식으로 채우기
      const r = Math.max(W / bg.width, H / bg.height);
      const dw = bg.width * r, dh = bg.height * r;
      ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = '#7c9866'; ctx.fillRect(0, 0, W, H);
    }

    // 반투명 상/하단 그라데이션 (텍스트 가독성)
    const top = ctx.createLinearGradient(0, 0, 0, 120);
    top.addColorStop(0, 'rgba(20,30,15,.55)'); top.addColorStop(1, 'rgba(20,30,15,0)');
    ctx.fillStyle = top; ctx.fillRect(0, 0, W, 120);
    const bot = ctx.createLinearGradient(0, H - 90, 0, H);
    bot.addColorStop(0, 'rgba(20,30,15,0)'); bot.addColorStop(1, 'rgba(20,30,15,.6)');
    ctx.fillStyle = bot; ctx.fillRect(0, H - 90, W, 90);

    // 달팽이들 (색/단계 스프라이트)
    const snails = DB.Snails.get().filter(function (s) { return s.stage !== 'egg'; });
    const imgs = await Promise.all(snails.map(function (s) {
      return _loadImage(GAME.spritePath(s.color, GAME.displayStage(s)));
    }));
    imgs.forEach(function (img, i) {
      if (!img) return;
      const size = 150;
      const col = i % 3, row = Math.floor(i / 3);
      const x = 70 + col * 175 + (row % 2) * 30;
      const y = 380 + row * 130;
      ctx.drawImage(img, x, y, size, size);
    });

    // 텍스트
    const dex = GAME.discoveredVariants(DB.Album.get(), DB.Snails.get());
    ctx.fillStyle = '#fff';
    ctx.font = '800 34px system-ui, sans-serif';
    ctx.fillText('🐌 나의 달팽이 정원', 32, 56);
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText(snails.length + '마리 · ' + (player.generation || 1) + '세대 · 도감 ' +
      dex.length + '/' + Object.keys(GAME.VARIANTS).length, 32, 86);
    ctx.font = '500 15px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillText('junhoeku.github.io/snail', 32, H - 30);

    canvas.toBlob(function (blob) { _shareOrDownload(blob); }, 'image/png');
  }

  function _shareOrDownload(blob) {
    const file = new File([blob], 'snail-garden.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: '나의 달팽이 정원', text: '내 달팽이 정원을 구경해요! 🐌' })
        .catch(function () { /* 취소 무시 */ });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'snail-garden.png';
      a.click();
      URL.revokeObjectURL(url);
      Toast.show('🖼️ 카드를 저장했어요!');
    }
  }

  function bind() {
    const btn = document.getElementById('btn-share-card');
    if (btn) btn.addEventListener('click', makeCard);
  }

  return { makeCard: makeCard, bind: bind };
})();
