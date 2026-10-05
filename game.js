// 「午前1時の大脱走」ゲーム進行ロジック (1部屋分)
const Rules = require('./public/rules.js');

const DISPLAY_SIZE = 5;

function defaultSettings(n = 4) {
  return {
    rounds: 3,
    copiesPerRank: 6,      // 1〜8 各6枚
    wilds: 4,              // オールマイティ4枚
    handSize: { 2: 10, 3: 10, 4: 9, 5: 8 },
    finishersNeeded: 0,    // 0 = 「人数-1」人が和了ったら終了
    scoring: 'count',      // 'count' = 残り1枚1点 / 'rank' = 数字の合計(オールマイティは5点)
    passDraw: 0,           // パスしたときにディスプレイから取る枚数
  };
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDeck(s) {
  const d = [];
  let id = 0;
  for (let r = 1; r <= 8; r++) for (let i = 0; i < s.copiesPerRank; i++) d.push({ id: id++, r });
  for (let i = 0; i < s.wilds; i++) d.push({ id: id++, r: 0 });
  return shuffle(d);
}

const sortHand = h => h.sort((a, b) => (a.r || 99) - (b.r || 99) || a.id - b.id);
const label = c => (c.r === 0 ? '★' : String(c.r));
const cardsText = cs => Rules.arrange(cs).map(label).join(' ');

class Game {
  constructor(code) {
    this.code = code;
    this.players = []; // {id, token, name, hand, finished, scores[], connected}
    this.hostId = null;
    this.settings = defaultSettings();
    this.phase = 'lobby'; // lobby | playing | roundEnd | gameEnd
    this.round = 0;
    this.log = [];
    this.lastActive = Date.now();
  }

  // ---------- 便利関数 ----------
  p(id) { return this.players.find(x => x.id === id); }
  idx(id) { return this.players.findIndex(x => x.id === id); }
  addLog(t) { this.log.push(t); if (this.log.length > 60) this.log.shift(); }
  lastPlay() { return this.trick.length ? this.trick[this.trick.length - 1] : null; }
  finishersNeeded() {
    const n = this.players.length;
    const f = this.settings.finishersNeeded;
    return f > 0 ? Math.min(f, n - 1) : n - 1;
  }
  currentPlayer() { return this.players[this.turn]; }

  // ---------- ロビー ----------
  addPlayer(id, token, name) {
    if (this.phase !== 'lobby') throw new Error('ゲームはすでに始まっています');
    if (this.players.length >= 5) throw new Error('満員です(最大5人)');
    this.players.push({ id, token, name, hand: [], finished: false, scores: [], connected: true });
    if (!this.hostId) this.hostId = id;
    this.addLog(`${name} が入室しました`);
  }

  removePlayer(id) {
    const i = this.idx(id);
    if (i < 0) return;
    const [pl] = this.players.splice(i, 1);
    this.addLog(`${pl.name} が退室しました`);
    if (this.hostId === id) this.hostId = this.players[0] ? this.players[0].id : null;
  }

  updateSettings(id, s) {
    this.requireHost(id);
    if (this.phase !== 'lobby') throw new Error('ロビーでのみ変更できます');
    const cur = this.settings;
    const int = (v, lo, hi, d) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
    if (s.rounds != null) cur.rounds = int(s.rounds, 1, 10, cur.rounds);
    if (s.finishersNeeded != null) cur.finishersNeeded = int(s.finishersNeeded, 0, 4, cur.finishersNeeded);
    if (s.passDraw != null) cur.passDraw = int(s.passDraw, 0, 2, cur.passDraw);
    if (s.scoring === 'count' || s.scoring === 'rank') cur.scoring = s.scoring;
    if (s.handSize) for (const k of [2, 3, 4, 5]) if (s.handSize[k] != null) cur.handSize[k] = int(s.handSize[k], 3, 12, cur.handSize[k]);
  }

  requireHost(id) { if (id !== this.hostId) throw new Error('ホストのみ操作できます'); }

  start(id) {
    this.requireHost(id);
    if (this.phase !== 'lobby' && this.phase !== 'gameEnd') throw new Error('開始できません');
    if (this.players.length < 2) throw new Error('2人以上必要です');
    for (const pl of this.players) pl.scores = [];
    this.round = 0;
    this.log = [];
    this.startRound();
  }

  nextRound(id) {
    this.requireHost(id);
    if (this.phase !== 'roundEnd') throw new Error('まだラウンド中です');
    this.startRound();
  }

  backToLobby(id) {
    this.requireHost(id);
    this.phase = 'lobby';
    for (const pl of this.players) { pl.hand = []; pl.scores = []; pl.finished = false; }
    this.players = this.players.filter(pl => pl.connected);
    if (!this.p(this.hostId)) this.hostId = this.players[0] ? this.players[0].id : null;
  }

  // ---------- ラウンド進行 ----------
  startRound() {
    this.round++;
    const n = this.players.length;
    const hs = this.settings.handSize[n] || 8;
    const deck = makeDeck(this.settings);
    for (const pl of this.players) {
      pl.hand = sortHand(deck.splice(0, hs));
      pl.finished = false;
    }
    this.display = deck.splice(0, DISPLAY_SIZE);
    this.pile = deck;
    this.trick = [];      // 今の場: [{pid, cards}]
    this.finishOrder = [];
    this.turn = (this.round - 1) % n;
    this.stage = 'act';   // act | draw
    this.added = false;
    this.draw = null;     // {min,max}
    this.phase = 'playing';
    this.lastResult = null;
    this.addLog(`―― 第${this.round}ラウンド開始 (手札${hs}枚) ――`);
    this.addLog(`${this.currentPlayer().name} から脱走開始！`);
  }

  requireTurn(id, stage) {
    if (this.phase !== 'playing') throw new Error('ラウンド中ではありません');
    const cur = this.currentPlayer();
    if (cur.id !== id) throw new Error('あなたの手番ではありません');
    if (stage && this.stage !== stage) throw new Error(stage === 'act' ? '先にディスプレイからカードを取ってください' : '今はカードを取る場面ではありません');
    return cur;
  }

  takeFromHand(pl, ids) {
    if (new Set(ids).size !== ids.length) throw new Error('同じカードが重複しています');
    const cards = ids.map(cid => {
      const c = pl.hand.find(h => h.id === cid);
      if (!c) throw new Error('手札にないカードです');
      return c;
    });
    return cards;
  }

  removeFromHand(pl, cards) {
    const set = new Set(cards.map(c => c.id));
    pl.hand = pl.hand.filter(c => !set.has(c.id));
  }

  // 場札に手札から1枚付け足す(手番中1回まで)
  add(id, cardId) {
    const pl = this.requireTurn(id, 'act');
    const last = this.lastPlay();
    if (!last) throw new Error('場札がないので付け足せません');
    if (this.added) throw new Error('付け足しは1手番に1枚までです');
    const [card] = this.takeFromHand(pl, [cardId]);
    if (!Rules.canAdd(last.cards, card)) throw new Error('ラン/セットが崩れるので付け足せません');
    this.removeFromHand(pl, [card]);
    last.cards.push(card);
    this.added = true;
    this.addLog(`${pl.name} が場札に ${label(card)} を付け足し → [${cardsText(last.cards)}]`);
    if (pl.hand.length === 0) { this.finish(pl); this.advance(); }
  }

  play(id, cardIds) {
    const pl = this.requireTurn(id, 'act');
    if (!Array.isArray(cardIds) || cardIds.length === 0) throw new Error('カードを選んでください');
    const cards = this.takeFromHand(pl, cardIds);
    const last = this.lastPlay();
    const lastSize = last ? last.cards.length : 0;
    if (!Rules.isValidCombo(cards)) throw new Error('ラン(連番)かセット(同じ数字)で出してください');
    const { min, max } = Rules.allowedSizes(lastSize);
    if (cards.length < min || cards.length > max) throw new Error(`${min}〜${max}枚で出してください`);
    this.removeFromHand(pl, cards);
    this.trick.push({ pid: pl.id, cards: cards.slice() });
    this.addLog(`${pl.name} が [${cardsText(cards)}] を出した`);
    if (pl.hand.length === 0) { this.finish(pl); this.advance(); return; }
    this.beginDraw(1, 2);
  }

  pass(id) {
    const pl = this.requireTurn(id, 'act');
    if (!this.lastPlay()) throw new Error('場が空のときはパスできません。1〜3枚出してください');
    this.trick = [];
    this.addLog(`${pl.name} はパス。場札が流れた`);
    const n = this.settings.passDraw;
    if (n > 0) this.beginDraw(n, n); else this.advance();
  }

  beginDraw(min, max) {
    if (this.display.length === 0) { this.advance(); return; }
    this.stage = 'draw';
    this.draw = { min: Math.min(min, this.display.length), max: Math.min(max, this.display.length) };
  }

  take(id, cardIds) {
    const pl = this.requireTurn(id, 'draw');
    if (!Array.isArray(cardIds)) throw new Error('カードを選んでください');
    if (new Set(cardIds).size !== cardIds.length) throw new Error('重複しています');
    const { min, max } = this.draw;
    if (cardIds.length < min || cardIds.length > max) throw new Error(min === max ? `${min}枚取ってください` : `${min}〜${max}枚取ってください`);
    const cards = cardIds.map(cid => {
      const c = this.display.find(d => d.id === cid);
      if (!c) throw new Error('ディスプレイにないカードです');
      return c;
    });
    const set = new Set(cardIds);
    this.display = this.display.filter(c => !set.has(c.id));
    pl.hand = sortHand(pl.hand.concat(cards));
    while (this.display.length < DISPLAY_SIZE && this.pile.length) this.display.push(this.pile.shift());
    this.addLog(`${pl.name} がディスプレイから ${cards.map(label).join(' ')} を獲得`);
    this.advance();
  }

  finish(pl) {
    pl.finished = true;
    this.finishOrder.push(pl.id);
    this.addLog(`🎉 ${pl.name} が脱走成功！(${this.finishOrder.length}番手)`);
  }

  advance() {
    this.stage = 'act';
    this.added = false;
    this.draw = null;
    const remaining = this.players.filter(x => !x.finished);
    if (this.finishOrder.length >= this.finishersNeeded() || remaining.length <= 1) { this.endRound(); return; }
    const n = this.players.length;
    let i = this.turn;
    do { i = (i + 1) % n; } while (this.players[i].finished);
    this.turn = i;
    // 場札を出した本人に手番が戻った(他の全員が和了った等)場合は場を流す
    const last = this.lastPlay();
    if (last && last.pid === this.players[i].id) { this.trick = []; }
  }

  scoreOf(hand) {
    if (this.settings.scoring === 'rank') return hand.reduce((s, c) => s + (c.r === 0 ? 5 : c.r), 0);
    return hand.length;
  }

  endRound() {
    const res = this.players.map(pl => {
      const pts = pl.finished ? 0 : this.scoreOf(pl.hand);
      pl.scores.push(pts);
      return { id: pl.id, name: pl.name, points: pts, rank: pl.finished ? this.finishOrder.indexOf(pl.id) + 1 : null, hand: sortHand(pl.hand.slice()) };
    });
    this.lastResult = { round: this.round, result: res };
    this.addLog(`―― 第${this.round}ラウンド終了 ――`);
    this.phase = this.round >= this.settings.rounds ? 'gameEnd' : 'roundEnd';
    if (this.phase === 'gameEnd') {
      const tot = this.totals();
      const best = Math.min(...tot.map(t => t.total));
      this.winners = tot.filter(t => t.total === best).map(t => t.name);
      this.addLog(`🏆 勝者: ${this.winners.join('、')}`);
    }
  }

  totals() {
    return this.players.map(pl => ({ id: pl.id, name: pl.name, total: pl.scores.reduce((a, b) => a + b, 0) }));
  }

  // ---------- プレイヤーごとの見え方 ----------
  view(forId) {
    const me = this.p(forId);
    const playing = this.phase !== 'lobby';
    return {
      code: this.code,
      you: forId,
      hostId: this.hostId,
      phase: this.phase,
      round: this.round,
      settings: this.settings,
      finishersNeeded: this.players.length >= 2 ? this.finishersNeeded() : 1,
      players: this.players.map(pl => ({
        id: pl.id, name: pl.name, connected: pl.connected,
        count: pl.hand.length, finished: pl.finished,
        rank: playing && this.finishOrder ? (this.finishOrder.indexOf(pl.id) + 1 || null) : null,
        scores: pl.scores, total: pl.scores.reduce((a, b) => a + b, 0),
      })),
      hand: me ? me.hand : [],
      display: playing ? this.display : [],
      pileCount: playing ? this.pile.length : 0,
      trick: playing ? this.trick.map(t => ({ pid: t.pid, cards: Rules.arrange(t.cards) })) : [],
      turnId: this.phase === 'playing' ? this.currentPlayer().id : null,
      stage: this.stage,
      draw: this.draw,
      added: this.added,
      log: this.log.slice(-30),
      lastResult: this.lastResult,
      winners: this.phase === 'gameEnd' ? this.winners : null,
    };
  }
}

module.exports = { Game, defaultSettings, makeDeck };
