// 実サーバーを起動してWebSocket経由で3人対戦を最後まで回す
const { spawn } = require('child_process');
const WebSocket = require('ws');
const R = require('../public/rules.js');
const PORT = 3999;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT }, cwd: __dirname + '/..' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(name) {
  const ws = new WebSocket('ws://localhost:' + PORT);
  const c = { ws, name, state: null, errors: [], joined: null };
  ws.on('message', d => { const m = JSON.parse(d); if (m.type === 'state') c.state = m.state; if (m.type === 'joined') c.joined = m; if (m.type === 'error') c.errors.push(m.message); });
  c.send = m => ws.send(JSON.stringify(m));
  return new Promise(r => ws.on('open', () => r(c)));
}
function subsets(h,k){const o=[];const f=(s,a)=>{if(a.length===k){o.push(a.slice());return}for(let i=s;i<h.length;i++){a.push(h[i]);f(i+1,a);a.pop()}};f(0,[]);return o}
(async () => {
  await sleep(500);
  const a = await client('A'); a.send({ type: 'create', name: 'アリス' }); await sleep(150);
  const code = a.joined.code;
  const b = await client('B'); b.send({ type: 'join', name: 'ボブ', code }); 
  const c = await client('C'); c.send({ type: 'join', name: 'キャロル', code }); await sleep(200);
  // 手札が他人に見えないこと
  a.send({ type: 'start' }); await sleep(200);
  if (JSON.stringify(b.state).includes('"token"')) throw new Error('token漏洩');
  if (b.state.hand.length !== 10) throw new Error('配り枚数');
  // 再接続テスト
  const sess = b.joined; b.ws.close(); await sleep(150);
  if (a.state.players[1].connected) throw new Error('切断検知されない');
  const b2 = await client('B2'); b2.send({ type: 'rejoin', code, pid: sess.pid, token: sess.token }); await sleep(150);
  if (!b2.state || b2.state.hand.length !== 10) throw new Error('再接続失敗');
  const cs = [a, b2, c];
  // 手番外操作はエラー
  const notTurn = cs.find(x => x.state.turnId !== x.state.you);
  notTurn.send({ type: 'pass' }); await sleep(80);
  if (!notTurn.errors.length) throw new Error('手番外操作が通った');
  let steps = 0;
  while (true) {
    await sleep(15);
    const s = a.state;
    if (s.phase === 'gameEnd') break;
    if (s.phase === 'roundEnd') { a.send({ type: 'next' }); await sleep(60); continue; }
    const me = cs.find(x => x.state.you === s.turnId); const st = me.state;
    if (st.turnId !== s.turnId) continue;
    steps++;
    if (st.stage === 'draw') { me.send({ type: 'take', cardIds: st.display.slice(0, st.draw.min).map(x => x.id) }); await sleep(30); continue; }
    const last = st.trick[st.trick.length - 1];
    const { min, max } = R.allowedSizes(last ? last.cards.length : 0);
    let sent = false;
    for (let k = Math.min(max, st.hand.length); k >= min && !sent; k--) { const o = subsets(st.hand, k).find(R.isValidCombo); if (o) { me.send({ type: 'play', cardIds: o.map(x => x.id) }); sent = true; } }
    if (!sent) me.send({ type: 'pass' });
    await sleep(30);
    if (steps > 3000) throw new Error('終わらない');
  }
  console.log('OK: WebSocket 3人対戦完走', steps, '手 勝者:', a.state.winners.join(','), 'エラー:', [a,b2,c].flatMap(x=>x.errors).length - 1);
  srv.kill(); process.exit(0);
})().catch(e => { console.error('FAIL', e); srv.kill(); process.exit(1); });
