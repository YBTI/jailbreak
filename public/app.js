// 午前1時の大脱走 クライアント
(() => {
  const $ = id => document.getElementById(id);
  const LS = 'jailbreak.session';
  let ws, state = null, session = load(), sel = new Set(), dispSel = new Set(), retry = 0, pending = null;

  function load() { try { return JSON.parse(localStorage.getItem(LS)) || null; } catch { return null; } }
  function save(s) { session = s; try { s ? localStorage.setItem(LS, JSON.stringify(s)) : localStorage.removeItem(LS); } catch {} }
  try { $('nameInput').value = localStorage.getItem('jailbreak.name') || ''; } catch {}
  const m = location.pathname.match(/^\/room\/([A-Za-z0-9]{4})/);
  if (m) $('codeInput').value = m[1].toUpperCase();

  // ---------- 通信 ----------
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => {
      retry = 0; $('conn').classList.add('hidden');
      if (session) send({ type: 'rejoin', ...session });
      if (pending) { send(pending); pending = null; }
    };
    ws.onmessage = e => onMsg(JSON.parse(e.data));
    ws.onclose = () => {
      if (session) $('conn').classList.remove('hidden');
      setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
    };
  }
  function send(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    else pending = msg;
  }
  setInterval(() => send({ type: 'ping' }), 25000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ws && ws.readyState > 1) connect();
  });

  function onMsg(msg) {
    if (msg.type === 'joined') {
      save({ code: msg.code, pid: msg.pid, token: msg.token });
      history.replaceState(null, '', '/room/' + msg.code);
    } else if (msg.type === 'state') {
      const prevTurn = state && state.turnId, prevStage = state && state.stage;
      state = msg.state;
      if (state.turnId !== prevTurn || state.stage !== prevStage) { sel.clear(); dispSel.clear(); }
      // 手札に無くなったカードは選択解除
      const ids = new Set(state.hand.map(c => c.id));
      [...sel].forEach(id => { if (!ids.has(id)) sel.delete(id); });
      if (state.turnId === state.you && prevTurn !== state.you && navigator.vibrate) navigator.vibrate(80);
      render();
    } else if (msg.type === 'error') {
      toast(msg.message);
    } else if (msg.type === 'rejoinFailed' || msg.type === 'left') {
      save(null); state = null; history.replaceState(null, '', '/'); show('home');
      $('conn').classList.add('hidden');
    }
  }

  // ---------- 画面 ----------
  function show(id) {
    ['home', 'lobby', 'game'].forEach(s => $(s).classList.toggle('hidden', s !== id));
  }
  let toastTimer;
  function toast(t) {
    const el = $('toast'); el.textContent = t; el.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
  }
  const lbl = r => (r === 0 ? '★' : r);
  function cardEl(c, opts = {}) {
    const d = document.createElement('div');
    d.className = 'card r' + c.r + (opts.tap ? ' tap' : '') + (opts.sel ? ' sel' : '');
    d.textContent = lbl(c.r);
    d.dataset.l = lbl(c.r);
    if (opts.onClick) d.onclick = opts.onClick;
    return d;
  }
  const nameOf = id => (state.players.find(p => p.id === id) || {}).name || '?';
  const me = () => state.players.find(p => p.id === state.you);
  const isHost = () => state.hostId === state.you;

  function render() {
    if (!state) return show('home');
    if (state.phase === 'lobby') { renderLobby(); show('lobby'); $('resultModal').classList.add('hidden'); return; }
    renderGame(); show('game');
    renderResult();
  }

  function fillSelect(el, from, to, val) {
    if (!el.options.length) for (let i = from; i <= to; i++) el.add(new Option(i, i));
    el.value = val;
  }
  function renderLobby() {
    $('lobbyCode').textContent = state.code;
    const ul = $('lobbyPlayers'); ul.innerHTML = '';
    state.players.forEach(p => {
      const li = document.createElement('li');
      li.innerHTML = `<span></span><span>${p.id === state.hostId ? '<span class="tag">ホスト</span>' : ''}${p.connected ? '' : '<span class="tag off">切断中</span>'}</span>`;
      li.firstChild.textContent = p.name + (p.id === state.you ? '（あなた）' : '');
      ul.appendChild(li);
    });
    const s = state.settings, host = isHost();
    fillSelect($('sRounds'), 1, 10, s.rounds);
    $('sFinish').value = s.finishersNeeded; $('sScoring').value = s.scoring; $('sPassDraw').value = s.passDraw;
    [2, 3, 4, 5].forEach(n => fillSelect($('sH' + n), 3, 12, s.handSize[n]));
    document.querySelectorAll('#settingsBox select').forEach(el => (el.disabled = !host));
    $('settingsNote').textContent = host ? '' : '（ホストが変更できます）';
    $('startBtn').classList.toggle('hidden', !host);
    $('startBtn').disabled = state.players.length < 2;
    $('waitMsg').textContent = host ? (state.players.length < 2 ? '2人以上で開始できます（最大5人）' : '') : 'ホストの開始を待っています…';
  }

  function renderGame() {
    const myTurn = state.turnId === state.you && state.phase === 'playing';
    const trick = state.trick, last = trick[trick.length - 1];
    $('roundInfo').textContent = `第${state.round}/${state.settings.rounds}ラウンド`;
    $('pileInfo').textContent = `山札 ${state.pileCount}枚 ・ ${state.finishersNeeded}人脱走で終了`;

    // プレイヤー
    const op = $('opponents'); op.innerHTML = '';
    state.players.forEach(p => {
      const d = document.createElement('div');
      d.className = 'opp' + (p.id === state.turnId ? ' turn' : '') + (p.id === state.you ? ' me' : '') + (p.finished ? ' done' : '');
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = p.name;
      if (p.id === state.you) { const y = document.createElement('span'); y.className = 'you'; y.textContent = 'あなた'; nm.appendChild(y); }
      d.appendChild(nm);
      const info = document.createElement('div');
      info.innerHTML = p.finished ? `<span class="esc">脱走${p.rank}位</span>` : `<span class="cnt">${p.count}</span>枚`;
      info.innerHTML += ` <span class="muted">計${p.total}点</span>` + (p.connected ? '' : ' <span class="dc">切断</span>');
      d.appendChild(info);
      op.appendChild(d);
    });

    // 場札
    const prev = $('trickPrev'); prev.innerHTML = '';
    trick.slice(0, -1).slice(-4).forEach(t => {
      const g = document.createElement('div'); g.className = 'grp';
      t.cards.forEach(c => g.appendChild(cardEl(c)));
      prev.appendChild(g);
    });
    const tr = $('trick'); tr.innerHTML = '';
    if (last) {
      last.cards.forEach(c => tr.appendChild(cardEl(c)));
      const w = document.createElement('div'); w.className = 'who'; w.textContent = `${nameOf(last.pid)} が出した（${last.cards.length}枚）`;
      tr.appendChild(w);
      const { min, max } = Rules.allowedSizes(last.cards.length);
      $('tableInfo').textContent = `次は ${min}〜${max}枚`;
    } else {
      tr.innerHTML = '<div class="empty">場は空です（1〜3枚自由に出せる）</div>';
      $('tableInfo').textContent = '';
    }

    // ディスプレイ
    const drawing = myTurn && state.stage === 'draw';
    const dp = $('display'); dp.innerHTML = '';
    state.display.forEach(c => dp.appendChild(cardEl(c, {
      tap: drawing, sel: dispSel.has(c.id),
      onClick: drawing ? () => {
        if (dispSel.has(c.id)) dispSel.delete(c.id);
        else { if (dispSel.size >= state.draw.max) { const f = dispSel.values().next().value; dispSel.delete(f); } dispSel.add(c.id); }
        renderGame();
      } : null,
    })));
    $('displayInfo').textContent = drawing ? `${state.draw.min === state.draw.max ? state.draw.min : state.draw.min + '〜' + state.draw.max}枚えらんで取る` : '';

    // 手札
    const hd = $('hand'); hd.innerHTML = '';
    const canSelect = myTurn && state.stage === 'act';
    state.hand.forEach(c => hd.appendChild(cardEl(c, {
      tap: canSelect, sel: sel.has(c.id),
      onClick: canSelect ? () => { sel.has(c.id) ? sel.delete(c.id) : sel.add(c.id); renderGame(); } : null,
    })));

    // ボタン
    const picked = state.hand.filter(c => sel.has(c.id));
    const actMode = myTurn && state.stage === 'act';
    ['addBtn', 'playBtn', 'passBtn'].forEach(b => $(b).classList.toggle('hidden', drawing));
    $('takeBtn').classList.toggle('hidden', !drawing);
    $('playBtn').textContent = picked.length ? `${picked.length}枚出す` : '出す';
    $('playBtn').disabled = !(actMode && Rules.canPlay(picked, last ? last.cards.length : 0));
    $('addBtn').disabled = !(actMode && last && !state.added && picked.length === 1 && Rules.canAdd(last.cards, picked[0]));
    $('passBtn').disabled = !(actMode && last);
    if (drawing) $('takeBtn').disabled = dispSel.size < state.draw.min || dispSel.size > state.draw.max;
    $('takeBtn').textContent = dispSel.size ? `${dispSel.size}枚取る` : '取る';

    // ステータス
    const st = $('status');
    st.classList.toggle('mine', myTurn);
    if (state.phase !== 'playing') st.textContent = 'ラウンド終了';
    else if (!myTurn) st.textContent = `${nameOf(state.turnId)} の手番です…` + (me() && me().finished ? '（あなたは脱走済み）' : '');
    else if (drawing) st.textContent = 'ディスプレイからカードを選んで「取る」';
    else if (!last) st.textContent = 'あなたの番：ランかセットで1〜3枚出そう';
    else {
      const { min, max } = Rules.allowedSizes(last.cards.length);
      st.textContent = (state.added ? '' : '場札に1枚付け足せます。') + `${min}〜${max}枚出すかパス`;
    }
    if (myTurn && !drawing && picked.length && !Rules.isValidCombo(picked)) st.textContent = 'その組み合わせはラン/セットになりません';

    // ログ
    const ll = $('logList'); ll.innerHTML = '';
    state.log.slice().reverse().forEach(t => { const li = document.createElement('li'); li.textContent = t; ll.appendChild(li); });
  }

  function renderResult() {
    const show = state.phase === 'roundEnd' || state.phase === 'gameEnd';
    $('resultModal').classList.toggle('hidden', !show);
    if (!show) return;
    const end = state.phase === 'gameEnd';
    $('resultTitle').textContent = end ? `🏆 ゲーム終了！ 勝者：${state.winners.join('、')}` : `第${state.round}ラウンド終了`;
    const res = state.lastResult ? state.lastResult.result : [];
    const t = $('resultTable'); t.innerHTML = '';
    const head = document.createElement('tr');
    head.innerHTML = '<th>プレイヤー</th>' + Array.from({ length: state.round }, (_, i) => `<th>R${i + 1}</th>`).join('') + '<th>合計</th>';
    t.appendChild(head);
    const best = Math.min(...state.players.map(p => p.total));
    state.players.slice().sort((a, b) => a.total - b.total).forEach(p => {
      const tr = document.createElement('tr');
      if (end && p.total === best) tr.className = 'win';
      const r = res.find(x => x.id === p.id);
      const nameTd = document.createElement('td');
      nameTd.textContent = p.name + (r && r.rank ? ` (脱走${r.rank}位)` : '');
      if (r && r.hand.length) { const left = document.createElement('div'); left.className = 'left'; r.hand.forEach(c => left.appendChild(cardEl(c))); nameTd.appendChild(left); }
      tr.appendChild(nameTd);
      p.scores.forEach(s => { const td = document.createElement('td'); td.textContent = s ? '−' + s : '0'; tr.appendChild(td); });
      const tot = document.createElement('td'); tot.innerHTML = `<b>${p.total ? '−' + p.total : 0}</b>`; tr.appendChild(tot);
      t.appendChild(tr);
    });
    const host = isHost();
    $('nextBtn').classList.toggle('hidden', end || !host);
    $('againBtn').classList.toggle('hidden', !end || !host);
    $('toLobbyBtn').classList.toggle('hidden', !end || !host);
    $('resultWait').textContent = host ? '' : 'ホストの操作を待っています…';
  }

  // ---------- 操作 ----------
  const getName = () => { const n = $('nameInput').value.trim(); try { localStorage.setItem('jailbreak.name', n); } catch {} return n; };
  $('createBtn').onclick = () => { const n = getName(); if (!n) return toast('名前を入力してください'); send({ type: 'create', name: n }); };
  $('joinBtn').onclick = () => {
    const n = getName(), c = $('codeInput').value.trim().toUpperCase();
    if (!n) return toast('名前を入力してください');
    if (c.length !== 4) return toast('4文字の部屋コードを入力してください');
    send({ type: 'join', name: n, code: c });
  };
  $('shareBtn').onclick = async () => {
    const url = location.origin + '/room/' + state.code;
    const text = `「午前1時の大脱走」で遊ぼう！部屋コード: ${state.code}`;
    try {
      if (navigator.share) await navigator.share({ title: '午前1時の大脱走', text, url });
      else { await navigator.clipboard.writeText(url); toast('リンクをコピーしました'); }
    } catch {}
  };
  const pushSettings = () => send({ type: 'settings', settings: {
    rounds: $('sRounds').value, finishersNeeded: $('sFinish').value, scoring: $('sScoring').value, passDraw: $('sPassDraw').value,
    handSize: { 2: $('sH2').value, 3: $('sH3').value, 4: $('sH4').value, 5: $('sH5').value },
  } });
  document.querySelectorAll('#settingsBox select').forEach(el => (el.onchange = pushSettings));
  $('startBtn').onclick = () => send({ type: 'start' });
  $('leaveBtn').onclick = () => { send({ type: 'leave' }); save(null); state = null; history.replaceState(null, '', '/'); show('home'); };
  $('playBtn').onclick = () => send({ type: 'play', cardIds: [...sel] });
  $('addBtn').onclick = () => send({ type: 'add', cardId: [...sel][0] });
  $('passBtn').onclick = () => send({ type: 'pass' });
  $('takeBtn').onclick = () => send({ type: 'take', cardIds: [...dispSel] });
  $('nextBtn').onclick = () => send({ type: 'next' });
  $('againBtn').onclick = () => send({ type: 'start' });
  $('toLobbyBtn').onclick = () => send({ type: 'lobby' });
  $('logBtn').onclick = () => $('logModal').classList.remove('hidden');
  $('logClose').onclick = () => $('logModal').classList.add('hidden');

  connect();
})();
