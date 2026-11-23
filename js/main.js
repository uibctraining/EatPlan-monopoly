/* EatPlan-monopoly · 主控制器（回合循环 + 事件播放 + 输入 + 联机） */
'use strict';

const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
let G = null;

/* 联机 guest 侧状态 */
let guestBooted = false, guestEnd = 0, guestWaitSig = '';
let lobbyPoll = null;
let autoTimer = null, autoCountdown = null;   // 15 秒无人加入 → 自动单机 2AI

/* ---------- 开局菜单 ---------- */
function initMenu() {
  $$('#optBots .chip, #optRounds .chip').forEach(c => {
    c.onclick = () => {
      Array.from(c.parentElement.children).forEach(x => x.classList.remove('on'));
      c.classList.add('on');
    };
  });
  $('#btnStart').onclick = () => {
    const bots = +$('#optBots .chip.on').dataset.v;
    const rounds = +$('#optRounds .chip.on').dataset.v;
    const botsKeys = ['fox', 'tiger', 'cat'].slice(0, bots);
    $('#startScreen').hidden = true;
    $('#game').hidden = false;
    startGame({ players: ['me', ...botsKeys], maxRounds: rounds,
      ctrls: ['local', ...botsKeys.map(() => 'ai')] });
  };

  /* ---- 联机房间流程 ---- */
  const msg = (t, warn) => { const m = $('#roomMsg'); m.textContent = t; m.style.color = warn ? '#FF9C8F' : '#FFD34D'; };
  const nick = () => ($('#nickName').value || '').trim() || ('吃货' + Math.random().toString(36).slice(2, 5));
  const rndEmoji = () => ['🐯', '🦜', '🐱'][Math.floor(Math.random() * 3)];

  $('#btnRoom').onclick = () => {
    $('#startScreen').hidden = true;
    $('#roomScreen').hidden = false;
    $('#roomStep1').hidden = false;
    $('#roomStep2').hidden = true;
    msg('创建后把 4 位房间码发给朋友，2–4 人同局', 0);
  };
  $('#btnRoomBack').onclick = () => { $('#roomScreen').hidden = true; $('#startScreen').hidden = false; };

  const renderRoomList = (players) => {
    $('#roomList').innerHTML = players.map((p, i) =>
      `<li>${p.emoji} ${p.name}${i === 0 ? '（房主）' : ''}</li>`).join('');
    const startBtn = $('#btnRoomStart');
    startBtn.hidden = !Net.isHost;
    startBtn.disabled = players.length < 2;
    startBtn.textContent = players.length < 2 ? '▶ 等朋友加入（2–6 人）' : `▶ 开始对局（${players.length} 人）`;
    if (Net.isHost && players.length >= 2 && (autoTimer || autoCountdown)) {
      clearTimeout(autoTimer); autoTimer = null;
      clearInterval(autoCountdown); autoCountdown = null;
      $('#roomWaitMsg').textContent = '玩家到齐，点开始对局';
    }
  };

  const showLobby = () => {
    $('#roomStep1').hidden = true;
    $('#roomStep2').hidden = false;
    $('#roomCodeBig').textContent = Net.code;
    $('#roomWaitMsg').hidden = Net.isHost;
    if (Net.isHost) {
      // 15 秒无人加入 → 自动开单机局（对战 2 个电脑 AI）
      let remain = 15;
      const rm = $('#roomWaitMsg');
      const tick = () => { rm.textContent = `15 秒内无人加入，自动开始单机（对战 2 个电脑）· ${remain}s`; };
      tick();
      autoCountdown = setInterval(() => { remain--; tick(); if (remain <= 0) { clearInterval(autoCountdown); autoCountdown = null; } }, 1000);
      autoTimer = setTimeout(async () => {
        clearInterval(autoCountdown); autoCountdown = null;
        clearInterval(lobbyPoll); lobbyPoll = null;      // 先停轮询，避免关房瞬间 in-flight 404
        try {
          const r = await Net.call('get');
          if (r && r.players && r.players.length > 1) return;   // 有人加入：不自动
        } catch (e) { /* 房间异常：照样转单机 */ }
        Net.leave();                                            // 关掉空房间
        $('#roomScreen').hidden = true;
        $('#game').hidden = false;
        const rounds = +$('#optRounds .chip.on').dataset.v;
        startGame({ players: ['me', 'fox', 'tiger'], maxRounds: rounds, ctrls: ['local', 'ai', 'ai'] });
      }, 15000);
    }
  };

  const lobbyTick = async () => {
    try {
      const r = await Net.call('get');
      if (r) renderRoomList(r.players);
      if (r && r.started && r.state) bootGuest(r);
    } catch (e) { /* 房间已关闭等 */ }
  };

  $('#btnRoomCreate').onclick = async () => {
    try { await Net.create(nick(), '🐼'); } catch (e) { msg('创建失败：' + e.message, 1); return; }
    showLobby();
    lobbyTick();
    lobbyPoll = setInterval(lobbyTick, 1500);
  };

  $('#btnRoomJoin').onclick = async () => {
    const code = ($('#roomCode').value || '').trim().toUpperCase();
    if (code.length !== 4) { msg('请输入 4 位房间码', 1); return; }
    try { await Net.join(code, nick(), rndEmoji()); } catch (e) { msg('加入失败：' + e.message, 1); return; }
    showLobby();
    lobbyTick();
    lobbyPoll = setInterval(lobbyTick, 1500);
  };

  $('#btnRoomStart').onclick = async () => {          // 仅房主可见
    try {
      clearInterval(lobbyPoll);
      const r = await Net.call('get');
      const names = r.players.map(p => ({ name: p.name, emoji: p.emoji }));
      if (names.length < 2) { msg('至少 2 人才能开始', 1); return; }
      const rounds = +$('#optRounds .chip.on').dataset.v;
      $('#roomScreen').hidden = true;
      $('#game').hidden = false;
      await startGame({
        players: ['me', 'p2', 'p3', 'p4', 'p5', 'p6'].slice(0, names.length),   // 上限 6 人
        maxRounds: rounds,
        ctrls: names.map((_, i) => (i === 0 ? 'local' : 'remote')),
        names,
      });
    } catch (e) { msg('开局失败：' + e.message, 1); }
  };

  $('#btnRoomQuit').onclick = () => {
    clearInterval(lobbyPoll);
    clearTimeout(autoTimer); autoTimer = null;
    clearInterval(autoCountdown); autoCountdown = null;
    Net.leave();
    guestBooted = false; guestEnd = 0; guestWaitSig = '';
    $('#roomScreen').hidden = true;
    $('#startScreen').hidden = false;
  };
}

/* ---------- 游戏启动（单机 / 房主联机共用） ---------- */
async function startGame(opts) {
  G = new Game(opts);
  G.players.forEach((p, i) => {
    p.ctrl = (opts.ctrls && opts.ctrls[i]) || (i === 0 ? 'local' : 'ai');
    p.isAI = p.ctrl === 'ai';
    p.seat = i;
    if (opts.names && opts.names[i]) { p.name = opts.names[i].name; p.emoji = opts.names[i].emoji; }
  });
  G.log = [];
  UI.game = G;
  UI.myKey = G.players[0].key;
  UI.remote = false;
  UI.buildBoard();
  UI.renderPlayers();
  UI.renderHUD();
  UI.feed('🎮 开局！经过 KLIA 领工资，买地收租，轮数到后净资产最高者胜', 'ev-sys');
  bindGameButtons();
  setTimeout(() => UI.findMe(), 120);   // 开局定位到自己所在格

  if (Net.online && Net.isHost) {
    UI.remote = false;
    await Net.start(G);          // 置 started=1 并广播初始 state
    Net.pushState(G, null);
  }
  turnLoop();
}

function bindGameButtons() {
  $('#btnBank').onclick = () => UI.bankPanel();
  $('#btnBankTop').onclick = () => UI.bankPanel();
  $('#btnNew').onclick = () => { if (confirm('重新开局？当前进度会丢失')) { Net.leave(); location.reload(); } };
  $('#toolbar').onclick = (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === 'in') UI.setZoom(UI.zoom + 0.25);
    else if (act === 'out') UI.setZoom(UI.zoom - 0.25);
    else if (act === 'fit') UI.fit();
    else if (act === 'me') UI.findMe();
    else if (act === 'map') UI.toggleMinimap();
  };
}

/* ---------- 回合循环（host / 单机） ---------- */
async function turnLoop() {
  while (G.phase !== 'end') {
    UI.renderPlayers();
    UI.renderHUD();
    Net.pushState(G, null);
    const p = G.current;
    if (p.bankrupt) { G.endTurn(); continue; }

    if (p.ctrl === 'ai') {
      await sleep(700);
      await doTurn(p);
    } else if (p.ctrl === 'remote') {
      const pr = Net.waitAct(p.seat, 'roll');
      Net.pushState(G, { kind: 'turn', seat: p.seat });
      const a = await pr;
      if (!a) { await sleep(2000); continue; }   // 房间解散：等待退出
      await doTurn(p);
    } else {
      await waitPlayerRoll();
    }
    if (G.phase === 'end') break;
    UI.renderPlayers();
    UI.renderHUD();
  }
  UI.renderPlayers();
  UI.renderHUD();
  Net.pushState(G, null);
  UI.settleModal();
}

function waitPlayerRoll() {
  return new Promise(res => {
    const btn = $('#btnRoll');
    btn.onclick = async () => {
      if (!G.canRoll()) return;
      btn.disabled = true;
      await doTurn(G.current);
      res();
    };
    btn.disabled = !G.canRoll();
  });
}

/* 单个玩家的一次完整行动（host 侧执行；remote 玩家的决策经 waitAct 远程收集） */
async function doTurn(p) {
  const ctrl = p.ctrl || 'local';
  const r = G.roll();
  if (!r) return;

  // 骰子动画
  for (let k = 0; k < 8; k++) {
    $('#die1').textContent = DICE[Math.floor(Math.random() * 6)];
    $('#die2').textContent = DICE[Math.floor(Math.random() * 6)];
    await sleep(55);
  }
  $('#die1').textContent = DICE[r.dice[0] - 1];
  $('#die2').textContent = DICE[r.dice[1] - 1];
  if (r.double) UI.feed(`${p.emoji} 掷出双数 ${r.dice[0]}+${r.dice[1]}！`, 'ev-sys');

  // 走格动画
  if (r.path.length) await UI.animateMove(p, r.path);
  UI.renderOwnership();
  Net.pushState(G, null);

  // 事件播放
  for (const ev of r.events) {
    if (ev.type === 'card') {
      const kcls = ev.kind === 'disaster' ? 'ev-bad' : ev.kind === 'lucky' ? 'ev-good' : 'ev-sys';
      if (ctrl === 'local') await UI.cardModal(ev);
      else { if (ctrl === 'ai') await sleep(400); UI.feed(`${p.emoji} ${ev.text}`, kcls); }
    } else if (ev.type === 'rent') {
      UI.feed(`${ev.text}`, ev.to === 'me' ? 'ev-good' : 'ev-bad');
      if (ev.to === 'me' || ev.from === 'me') await UI.payModal(ev, G);
      else await sleep(450);
    } else if (ev.type === 'salary') {
      UI.feed(`${p.emoji} ${ev.text}`, 'ev-good');
    } else if (ev.type === 'tax') {
      UI.feed(`${p.emoji} ${ev.text}`, 'ev-bad');
    } else if (ev.type === 'rest' || ev.type === 'restGo') {
      UI.feed(`${p.emoji} ${ev.text}`, 'ev-sys');
    } else if (ev.type === 'bankrupt') {
      UI.feed(`💥 ${ev.text}`, 'ev-bad');
      if (ctrl === 'local') await UI.modal(`<div class="m-emoji">💸</div><h3>破产了…</h3><div class="m-desc">地产收归银行，下次卷土重来</div><div class="m-row"><button class="m-btn yes" onclick="UI.closeModal()">好</button></div>`);
    }
    Net.pushState(G, null);
  }
  UI.renderPlayers();

  // 无主地决策
  if (G.phase === 'decide') {
    const t = G.tile(p.pos);
    let yes;
    if (ctrl === 'ai') {
      yes = AI.buy(G, p, t); await sleep(500);
    } else if (ctrl === 'remote') {
      const pr = Net.waitAct(p.seat, 'buy');
      Net.pushState(G, { kind: 'buy', seat: p.seat, cellId: t.i });
      const a = await pr;
      Net.pushState(G, null);
      yes = a ? !!a.v : false;
    } else {
      yes = await UI.buyModal(t, p);
    }
    G.decideBuy(yes);
    UI.renderOwnership();
    UI.renderPlayers();
    UI.feed(yes ? `${p.emoji} 买下 ${t.name} ${fmt(t.price)}` : `${p.emoji} 放弃 ${t.name}`, yes ? 'ev-good' : '');
    Net.pushState(G, null);
  }

  // AI：缺钱抵押 → 盖房
  if (ctrl === 'ai') {
    let guard = 0;
    let m;
    while ((m = AI.planMortgage(G, p)) !== null && guard++ < 8) {
      G.mortgage(m);
      UI.feed(`${p.emoji} 抵押 ${BOARD[m].name} 应急`, 'ev-bad');
      UI.renderOwnership(); UI.renderPlayers();
    }
    const b = AI.planBuild(G, p);
    if (b !== null && G.build(b)) {
      UI.renderOwnership(); UI.renderPlayers();
      UI.feed(`${p.emoji} 在 ${BOARD[b].name} 升级 ${['小贩摊', '茶室', '酒店'][G.houses[b] - 1]}`, 'ev-sys');
      await sleep(400);
    }
    // 穷爸爸富爸爸式现金流：闲钱自动配置保险 + 股票（每回合最多 2 笔）
    let invest = AI.planInvest(G, p);
    for (const act of invest.slice(0, 2)) {
      if (act.t === 'ins') {
        if (G.buyInsurance(p, act.id)) {
          const d = INSURANCE.find(x => x.id === act.id);
          UI.feed(`${p.emoji} 投保 ${d.icon}${d.name} -${fmt(d.premium)}`, 'ev-sys');
        }
      } else if (act.t === 'buyStock') {
        const cost = G.buyStock(p, act.id, 1);
        if (cost > 0) {
          const s = STOCKS.find(x => x.id === act.id);
          UI.feed(`${p.emoji} 买入 ${s.icon}${s.name} 1股 -${fmt(cost)}`, 'ev-sys');
        }
      }
      UI.renderPlayers(); UI.renderHUD();
      await sleep(250);
    }
  }

  G.endTurn();
  UI.renderPlayers();
  UI.renderHUD();
  Net.pushState(G, null);
  if (G.phase === 'end') return;
}

/* ---------- host 处理 guest 的银行动作（act 队列） ---------- */
window.applyRemoteAct = (a) => {
  if (!G || G.phase === 'end') return true;                 // 过期动作直接吞掉
  const p = G.players[a.seat];
  if (!p || p.ctrl !== 'remote' || G.current !== p) return true;
  if (a.t === 'build') {
    const ok = G.build(+a.v);
    if (ok) { UI.renderOwnership(); UI.renderPlayers(); UI.feed(`${p.emoji} 盖房 🏨`, 'ev-good'); }
  } else if (a.t === 'mortgage') {
    const ok = G.mortgage(+a.v);
    if (ok) { UI.renderOwnership(); UI.renderPlayers(); UI.feed(`${p.emoji} 抵押 ${BOARD[+a.v].name} +半价`, 'ev-bad'); }
  } else if (a.t === 'repay') {
    const pay = G.repay(+a.v);
    UI.renderPlayers();
    if (pay > 0) UI.feed(`${p.emoji} 还贷 ${fmt(pay)}`, 'ev-sys');
  } else if (a.t === 'buyStock') {
    const cost = G.buyStock(p, a.v, 1);
    UI.renderPlayers(); UI.renderHUD();
    if (cost > 0) {
      const s = STOCKS.find(x => x.id === a.v);
      UI.feed(`${p.emoji} 买入 ${s ? s.icon + s.name : a.v} 1股 -${fmt(cost)}`, 'ev-sys');
    }
  } else if (a.t === 'sellStock') {
    const gain = G.sellStock(p, a.v, 1);
    UI.renderPlayers(); UI.renderHUD();
    if (gain > 0) {
      const s = STOCKS.find(x => x.id === a.v);
      UI.feed(`${p.emoji} 卖出 ${s ? s.icon + s.name : a.v} 1股 +${fmt(gain)}`, 'ev-good');
    }
  } else if (a.t === 'buyIns') {
    const ok = G.buyInsurance(p, a.v);
    UI.renderPlayers();
    if (ok) {
      const d = INSURANCE.find(x => x.id === a.v);
      UI.feed(`${p.emoji} 投保 ${d ? d.icon + d.name : a.v} -${fmt(d ? d.premium : 0)}`, 'ev-sys');
    }
  }
  Net.pushState(G, Net.wait);
  return true;
};

/* ---------- guest 侧：状态轮询 → 渲染 + 本地动作 ---------- */
function bootGuest(r) {
  if (guestBooted) return;
  guestBooted = true;
  clearInterval(lobbyPoll);
  G = Object.assign(Object.create(Game.prototype), r.state);
  UI.game = G;
  UI.myKey = Net.myKey;
  UI.remote = true;
  $('#roomScreen').hidden = true;
  $('#game').hidden = false;
  UI.buildBoard();
  renderFeed();
  UI.renderPlayers();
  UI.renderHUD();
  bindGameButtons();
  setTimeout(() => UI.findMe(), 120);
  $('#btnRoll').onclick = () => {
    if (!G || G.phase !== 'roll' || G.current.key !== Net.myKey || G.current.bankrupt) return;
    Net.act('roll');
    $('#btnRoll').disabled = true;
  };
  Net.guestLoop(onGuestState);   // lobby 轮询已停，切换为对局状态轮询
  UI.feed(`🌐 已进入房间 ${Net.code}，联机对局开始`, 'ev-sys');
}

function renderFeed() {
  const f = $('#feed');
  f.innerHTML = (G.log || []).map(x =>
    typeof x === 'string' ? `<div>${x}</div>` : `<div class="${x.c || ''}">${x.h}</div>`).join('');
}

async function guestBuy(w) {
  try {
    const t = BOARD[w.cellId];
    if (!t) { console.error('guestBuy: bad cellId', JSON.stringify(w)); return; }
    const me = G.players[Net.mySeat];
    const v = await UI.buyModal(t, me);
    Net.act('buy', v ? 1 : 0);
  } catch (e) { console.error('guestBuy failed:', e && e.message, JSON.stringify(w)); }
}

function onGuestState(r) {
  window.__lastR = r;   // 调试钩子：最近一次轮询结果
  if (!guestBooted) {
    if (!r.started && r.players) {   // lobby：只刷名单
      const list = $('#roomList');
      if (list) list.innerHTML = r.players.map((p, i) => `<li>${p.emoji} ${p.name}${i === 0 ? '（房主）' : ''}</li>`).join('');
    }
    if (r.started && r.state) bootGuest(r);
    return;
  }
  if (!r.state) return;
  G = Object.assign(Object.create(Game.prototype), r.state);
  UI.game = G;
  renderFeed();
  UI.renderPlayers();
  UI.renderOwnership();
  UI.renderTokens();
  UI.renderHUD();

  if (G.phase === 'end') {
    if (!guestEnd) { guestEnd = 1; UI.settleModal(); }
    return;
  }
  const w = r.wait;
  if (w && w.seat === Net.mySeat) {
    const sig = JSON.stringify(w);
    if (sig !== guestWaitSig) {
      guestWaitSig = sig;
      if (w.kind === 'buy') guestBuy(w);
    }
  } else if (guestWaitSig) {
    guestWaitSig = '';               // 等待已被 host 消除：关掉遗留弹窗
    if (!$('#modal').hidden && !guestEnd) UI.closeModal(false);
  }
}

/* ---------- 启动 ---------- */
initMenu();
