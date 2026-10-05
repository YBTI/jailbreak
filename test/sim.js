// ボット同士で大量にゲームを回してロジックを検証
const assert = require('assert');
const R = require('../public/rules.js');
const { Game } = require('../game');
const C = (...rs) => rs.map((r, i) => ({ id: i, r }));
// 役判定
assert(R.isValidCombo(C(3,3,0)));
assert(R.isValidCombo(C(3,5,0)));
assert(!R.isValidCombo(C(3,6,0)));
assert(R.isValidCombo(C(7,8,0)));      // 6-7-8 or 7-8-9? 範囲内で6,7,8
assert(R.isValidCombo(C(0,0,0)));
assert(!R.isValidCombo(C(1,1,2)));
assert(R.isValidCombo(C(1,2,3,4,5,6,7,8)));
assert(!R.isValidCombo(C(1,2,3,4,5,6,7,8,0)));
assert(R.canPlay(C(4,4,4,4), 3) && !R.canPlay(C(4,4,4,4,4), 3) && !R.canPlay(C(2,3,4,5),0));

function subsets(hand, k) { const out=[]; const rec=(s,a)=>{ if(a.length===k){out.push(a.slice());return;} for(let i=s;i<hand.length;i++){a.push(hand[i]);rec(i+1,a);a.pop();} }; rec(0,[]); return out; }

let games = 0, rounds = 0, moves = 0;
for (let n = 2; n <= 5; n++) for (let g = 0; g < 150; g++) {
  const game = new Game('TEST');
  for (let i = 0; i < n; i++) game.addPlayer('p' + i, 't', 'P' + i);
  if (g % 3 === 0) game.updateSettings('p0', { passDraw: 1, scoring: 'rank' });
  game.start('p0');
  let guard = 0;
  while (game.phase !== 'gameEnd') {
    if (game.phase === 'roundEnd') { game.nextRound('p0'); continue; }
    if (++guard > 20000) throw new Error('無限ループ');
    const total = game.players.reduce((s,p)=>s+p.hand.length,0) + game.display.length + game.pile.length + game.trick.reduce((s,t)=>s+t.cards.length,0);
    const pl = game.currentPlayer(); moves++;
    assert(!pl.finished);
    if (game.stage === 'draw') {
      const k = game.draw.min + Math.floor(Math.random() * (game.draw.max - game.draw.min + 1));
      game.take(pl.id, game.display.slice(0, k).map(c => c.id));
      continue;
    }
    const last = game.lastPlay();
    if (last && !game.added && Math.random() < 0.5) {
      const c = pl.hand.find(h => R.canAdd(last.cards, h));
      if (c) { game.add(pl.id, c.id); continue; }
    }
    const { min, max } = R.allowedSizes(last ? last.cards.length : 0);
    let done = false;
    for (let k = Math.min(max, pl.hand.length); k >= min && !done; k--) {
      if (k > 6) continue;
      const opts = subsets(pl.hand, k).filter(s => R.isValidCombo(s));
      if (opts.length) { game.play(pl.id, opts[Math.floor(Math.random()*opts.length)].map(c=>c.id)); done = true; }
    }
    if (!done) {
      if (!last) throw new Error('リードで出せない: ' + JSON.stringify(pl.hand));
      game.pass(pl.id);
    }
    const total2 = game.players.reduce((s,p)=>s+p.hand.length,0) + (game.display||[]).length + game.pile.length + game.trick.reduce((s,t)=>s+t.cards.length,0);
    assert(total2 <= total);
  }
  // 不正操作チェック
  assert.throws(() => game.play('p1', []));
  games++; rounds += game.round;
  assert(game.winners.length >= 1);
  game.players.forEach(p => assert.strictEqual(p.scores.length, 3));
}
console.log(`OK: ${games}ゲーム / ${rounds}ラウンド / ${moves}手 シミュレーション成功`);
