/**
 * DexModule — 도감 화면 (변이 수집, 등급별 섹션)
 * 전역 네임스페이스: DexModule
 * 12차: 유저 탭에서 분리, 기본/레어/에픽 등급별로 진열한다.
 */
const DexModule = (function () {
  'use strict';

  // 진열 순서 (RARITIES 키). 에픽은 아직 변이가 없어 플레이스홀더로 보인다.
  const TIER_ORDER = ['common', 'rare', 'epic'];

  function _cell(key, found) {
    const cell = document.createElement('div');
    cell.className = 'dex-cell' + (found ? ' found' : '');

    if (found) {
      const img = document.createElement('img');
      img.className = 'dex-img';
      img.src = GAME.spritePath(key, 'baby');
      img.alt = GAME.VARIANTS[key].label;
      cell.appendChild(img);
    } else {
      const swatch = document.createElement('div');
      swatch.className = 'dex-swatch'; // 미발견 실루엣
      cell.appendChild(swatch);
    }

    const label = document.createElement('span');
    label.textContent = found ? GAME.VARIANTS[key].label : '???';
    cell.appendChild(label);
    return cell;
  }

  function render() {
    // 등급 완성 보상 정산 (로컬 모드) — 지급되면 코인/헤더가 갱신된다
    App.checkDexRewards();
    const discovered = GAME.discoveredVariants(DB.Album.get(), DB.Snails.get());
    const container = document.getElementById('dex-sections');
    if (!container) return;
    container.innerHTML = '';

    const total = Object.keys(GAME.VARIANTS).length;

    TIER_ORDER.forEach(function (tier) {
      const keys = Object.keys(GAME.VARIANTS).filter(function (k) {
        return GAME.VARIANTS[k].rarity === tier;
      });
      const foundCount = keys.filter(function (k) { return discovered.indexOf(k) !== -1; }).length;

      const section = document.createElement('div');
      section.className = 'dex-section';

      const title = document.createElement('h3');
      title.className = 'dex-section-title';
      const badge = document.createElement('span');
      badge.className = 'rarity-badge rarity-' + tier;
      badge.textContent = (GAME.RARITIES[tier] || { label: tier }).label;
      title.appendChild(badge);
      const prog = document.createElement('span');
      prog.className = 'dex-section-prog';
      prog.textContent = keys.length ? (foundCount + '/' + keys.length) : '준비 중';
      title.appendChild(prog);
      section.appendChild(title);

      if (keys.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'dex-empty';
        empty.textContent = '곧 새로운 달팽이를 만나요!';
        section.appendChild(empty);
      } else {
        const grid = document.createElement('div');
        grid.className = 'dex-grid';
        keys.forEach(function (key) {
          grid.appendChild(_cell(key, discovered.indexOf(key) !== -1));
        });
        section.appendChild(grid);
      }
      container.appendChild(section);
    });

    document.getElementById('dex-count').textContent =
      discovered.length + '/' + total + (discovered.length === total ? ' · 달팽이 박사 🏅' : '');
  }

  return { render: render };
})();
