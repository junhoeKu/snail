// GAME 순수 함수 시뮬레이션 테스트 (Node)
const fs = require('fs');
const path = require('path').join(__dirname, '..', 'js', 'game.js');
const GAME = eval(fs.readFileSync(path, 'utf8') + '\nGAME');

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); }
  else { failures++; console.error('  ✗ FAIL: ' + msg); }
}

// 초기 상태 (DB 기본값과 동일)
let snail = { schema_version: 1, name: '', level: 0, exp: 0, hunger: 0, happiness: 100, stage: 'egg', color: 'default', created_at: '2026-07-11T09:00:00.000Z' };
let player = { schema_version: 6, coins: 30, foods: { lettuce: 3 }, selected_food: 'lettuce', last_seen: '2026-07-11T09:00:00.000Z', last_daily_reward: null, background: 'default' };

console.log('[1] 알 상태 보호');
let r = GAME.feed(snail, player);
assert(r.events.includes('not_hatched') && r.player.foods.lettuce === 3, '알에게 먹이 불가, 상태 불변');
r = GAME.applyTimeDecay(snail, '2026-07-01T00:00:00.000Z', '2026-07-11T00:00:00.000Z');
assert(r.intervals === 0 && r.snail.hunger === 0, '알은 시간 감쇠 없음');

console.log('[2] 부화');
r = GAME.hatch(snail, '  ');
assert(r.events.includes('name_required'), '빈 이름 거부');
r = GAME.hatch(snail, '달달이');
assert(r.events.includes('hatched') && r.snail.stage === 'baby' && r.snail.level === 1, '부화 → baby Lv1');
assert(r.snail.hunger === 40 && r.snail.happiness === 80, '부화 초기 스탯 (hunger 40, happiness 80)');
snail = r.snail;

console.log('[3] 먹이 주기');
r = GAME.feed(snail, player);
assert(r.events.includes('fed'), '먹이 성공');
assert(r.snail.hunger === 10, 'hunger 40-30=10');
// 상추 exp 22 → Lv1(need5)+Lv2(need10) 소진 → Lv3, exp 7
assert(r.events.includes('levelup') && r.snail.level === 3 && r.snail.exp === 7, 'exp 22 → Lv3, exp 7');
assert(r.snail.happiness === 85, 'happiness 80+5=85');
assert(r.player.foods.lettuce === 2 && r.player.coins === 32, '상추 -1, 코인 +2');
snail = r.snail; player = r.player;

r = GAME.feed(snail, player); // hunger 10 → 0, exp 7+22=29 → Lv3(need15) 소진 → Lv4, exp 14
assert(r.events.includes('levelup') && r.snail.level === 4 && r.snail.exp === 14, 'exp 29 → Lv4, exp 14');
assert(r.snail.hunger === 0, 'hunger 하한 0');
snail = r.snail; player = r.player;

r = GAME.feed(snail, player);
assert(r.events.includes('not_hungry') && r.player.foods.lettuce === player.foods.lettuce, '배부르면 먹이 불가');

console.log('[4] 상추 소진 → no_food');
let p2 = JSON.parse(JSON.stringify(player)); p2.foods.lettuce = 0;
r = GAME.feed({ ...snail, hunger: 50 }, p2);
assert(r.events.includes('no_food'), '상추 없으면 실패');

console.log('[5] 시간 감쇠 (1시간 단위)');
r = GAME.applyTimeDecay(snail, '2026-07-11T09:00:00.000Z', '2026-07-11T12:30:00.000Z'); // 3.5시간
assert(r.intervals === 3, '3.5시간 → 3구간');
assert(r.snail.hunger === snail.hunger + 21, 'hunger +7×3');
assert(r.snail.happiness === snail.happiness - 15, 'happiness -5×3');
r = GAME.applyTimeDecay(snail, '2026-07-11T09:00:00.000Z', '2026-07-11T09:59:00.000Z');
assert(r.intervals === 0, '59분 → 0구간 (잔여 시간 보존)');
r = GAME.applyTimeDecay({ ...snail, hunger: 98, happiness: 3 }, '2026-07-01T00:00:00.000Z', '2026-07-11T00:00:00.000Z');
assert(r.snail.hunger === 100 && r.snail.happiness === 0, '상한 100 / 하한 0 클램프');

console.log('[6] 쓰다듬기');
r = GAME.pet(snail, player, '2026-07-11T12:00:00.000Z');
assert(r.events.includes('petted') && r.snail.happiness === Math.min(100, snail.happiness + 5), '쓰다듬기 → 행복 +5');
r = GAME.pet(r.snail, r.player, '2026-07-11T12:00:01.000Z');
assert(r.events.includes('petted'), '쿨다운 없이 즉시 반복 가능');
assert(GAME.pet({stage:'egg'}, player, '2026-07-11T12:00:00.000Z').events.includes('not_hatched'), '알 보호');

console.log('[7] 접속 보상 (스트릭)');
player.streak = { count: 0, last_date: null };
r = GAME.applyStreak(player, '2026-07-11');
assert(r.events.includes('daily_claimed') && r.player.coins === player.coins + 20, '1일차 +20');
player = r.player;
r = GAME.applyStreak(player, '2026-07-11');
assert(r.events.includes('already_claimed'), '같은 날 중복 불가');
r = GAME.applyStreak(player, '2026-07-12');
assert(r.events.includes('daily_claimed') && r.streak === 2, '다음 날 연속 2일차');

console.log('[8] 상추 구매');
r = GAME.buyFood(player, 'lettuce');
assert(r.events.includes('food_bought') && r.player.coins === player.coins - 10 && r.player.foods.lettuce === player.foods.lettuce + 1, '구매 성공 -10코인 +1상추');
r = GAME.buyFood({ ...player, coins: 9 }, 'lettuce');
assert(r.events.includes('not_enough_coins'), '코인 부족 시 실패');

console.log('[9] 성장 단계 전환 (핵심 루프 장기 시뮬레이션)');
let s = { name: '달달이', level: 1, exp: 0, hunger: 0, happiness: 80, stage: 'baby', color: 'default' };
let pl = { coins: 1000, foods: { lettuce: 0 }, selected_food: 'lettuce' };
let stageUps = [];
for (let i = 0; i < 400 && s.level < 20; i++) {
  s.hunger = 100; // 배고픈 상태 가정
  pl.foods.lettuce = 1;
  const out = GAME.feed(s, pl);
  s = out.snail; pl = out.player;
  if (out.events.includes('stage_up')) stageUps.push(s.level + ':' + s.stage);
}
assert(stageUps.join(',') === '10:junior,20:adult', '외형 변화 Lv10→junior, Lv20→adult (실제: ' + stageUps.join(',') + ')');
assert(GAME.expToNext(1) === 5 && GAME.expToNext(9) === 45, 'expToNext = level×5');

console.log(failures === 0 ? '\n✅ 전체 통과' : '\n❌ 실패 ' + failures + '건');
process.exit(failures === 0 ? 0 : 1);
