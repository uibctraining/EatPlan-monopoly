/* EatPlan-monopoly · 主控制器（回合循环 + 事件播放 + 输入） */
'use strict';

const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
let G = null;

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
    startGame({ players: ['me', ...botsKeys], maxRounds: rounds });
  };
  $('#btnRoom').onclick = () => { $('#startScreen').hidden = true; $('#roomScreen').hidden = false; };
  $('#btnRoomBack').onclick = () => { $('#roomScreen').hidden = true; $('#startScreen').hidden = false; };
  $('#btnRoomJoin').onclick = () => {
    const code = ($('#roomCode').value || '').trim().toUpperCase();
    $('#roomMsg').textContent = code
      ? `房间 ${code}：联网服务端下一阶段接入，先进单机局练手感 🎲`
      : '先输入 4 位房间码，或直接单人开局';
    $('#roomMsg').style.color = '#FFD34D';
    if (code) setTimeout(() => { $('#roomScreen').hidden = true; $('#startScreen').hidden = false; }, 1400);
  };
}

/* ---------- 游戏启动 ---------- */
function startGame(opts) {
  G = new Game(opts);
  UI.game = G;
  UI.buildBoard();
  UI.renderPlayers();
  UI.renderHUD();
  UI.feed('🎮 开局！经过 KLIA 领工资，买地收租，10 轮后净资产最高者胜', 'ev-sys');
  bindGameButtons();
  turnLoop();
}

function bindGameButtons() {
  $('#btnBank').onclick = () => UI.bankPanel();
  $('#btnBankTop').onclick = () => UI.bankPanel();
  $('#btnNew').onclick = () => { if (confirm('重新开局？当前进度会丢失')) location.reload(); };
  $('#toolbar').onclick = (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === 'in') UI.setZoom(UI.zoom + 0.25);
    else if (act === 'out') UI.setZoom(UI.zoom - 0.25);
    else if (act === 'fit') UI.setZoom(1);
    else if (act === 'me') UI.findMe();
    else if (act === 'map') UI.toggleMinimap();
  };
}

/* ---------- 回合循环 ---------- */
async function turnLoop() {
  while (G.phase !== 'end') {
    UI.renderPlayers();
    UI.renderHUD();
    const p = G.current;
    if (p.bankrupt) { G.endTurn(); continue; }

    if (p.isAI) {
      await sleep(700);
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

/* 单个玩家的一次完整行动 */
async function doTurn(p) {
  const isAI = p.isAI;
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

  // 事件播放
  for (const ev of r.events) {
    if (ev.type === 'card') {
      if (!isAI) await UI.cardModal(ev); else { UI.feed('(电脑略过)', ''); await sleep(500); }
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
      if (!isAI) await UI.modal(`<div class="m-emoji">💸</div><h3>破产了…</h3><div class="m-desc">地产收归银行，下次卷土重来</div><div class="m-row"><button class="m-btn yes" onclick="UI.closeModal()">好</button></div>`);
    }
  }
  UI.renderPlayers();

  // 无主地决策
  if (G.phase === 'decide') {
    const t = G.tile(p.pos);
    let yes;
    if (isAI) { yes = AI.buy(G, p, t); await sleep(500); }
    else yes = await UI.buyModal(t, p);
    G.decideBuy(yes);
    UI.renderOwnership();
    UI.renderPlayers();
    UI.feed(yes ? `${p.emoji} 买下 ${t.name} ${fmt(t.price)}` : `${p.emoji} 放弃 ${t.name}`, yes ? 'ev-good' : '');
  }

  // AI：缺钱抵押 → 盖房
  if (isAI) {
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
  }

  G.endTurn();
  UI.renderPlayers();
  UI.renderHUD();
  if (G.phase === 'end') return;
}

/* ---------- 启动 ---------- */
initMenu();
