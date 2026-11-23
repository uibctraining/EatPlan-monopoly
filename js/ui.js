/* EatPlan-monopoly · UI 渲染（棋盘/token/弹窗/动画） */
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fmt = (n) => 'RM' + Math.round(n).toLocaleString('en-MY');

const UI = {
  game: null,
  zoom: 1,
  baseSize: 1500,   // 大地图画布基准尺寸（缩放=改宽度）
  tokenEls: {},   // playerKey -> element
  myKey: 'me',    // 本机玩家（guest 时由 net 层设置）
  remote: false,  // guest 模式：按钮动作走 Net.act 上行

  /* ---------- 棋盘 ---------- */
  cellPos(i) {
    // 8×8 环：0-7 底行(右→左)、8-13 左列(下→上)、14-21 顶行(左→右)、22-27 右列(上→下)
    if (i <= 7)  return { r: 8, c: 8 - i };
    if (i <= 13) return { r: 8 - (i - 7), c: 1 };
    if (i <= 21) return { r: 1, c: (i - 13) };
    return { r: i - 19, c: 8 };
  },

  buildBoard() {
    const b = $('#board');
    b.innerHTML = '';
    for (let i = 0; i < N; i++) {
      const t = BOARD[i];
      const { r, c } = this.cellPos(i);
      const el = document.createElement('div');
      el.className = 'cell type-' + t.type;
      el.dataset.i = i;
      el.style.gridRow = r;
      el.style.gridColumn = c;
      let inner = `<span class="ci">${t.icon}</span><span class="cn">${t.name}</span>`;
      if (t.type === 'land') inner += `<span class="cp">${fmt(t.price)}</span><span class="band" style="background:${GROUPS[t.group].color}"></span>`;
      else if (t.desc) inner += `<span class="cp" style="color:#9FC6D6">${t.desc.slice(0, 8)}</span>`;
      el.innerHTML = inner;
      el.addEventListener('click', () => this.showTile(i));
      b.appendChild(el);
    }
    const center = document.createElement('div');
    center.className = 'center';
    center.innerHTML = `<div class="map">🇲🇾<small>MALAYSIA</small></div><div class="banner" id="centerBanner">吃遍 13 州 · 盖章集邮</div>`;
    b.appendChild(center);
    this.renderOwnership();
    this.renderTokens();
    $('#minimap').hidden = false;   // 小地图常驻（参考环游大富翁样式）
    this.renderMinimap();
  },

  renderOwnership() {
    const g = this.game;
    $$('#board .cell').forEach(el => {
      const i = +el.dataset.i;
      el.classList.remove('owned');
      const owner = g.owners[i];
      let flag = el.querySelector('.owner-dot');
      if (owner) {
        const p = g.players.find(x => x.key === owner);
        if (!flag) { flag = document.createElement('span'); flag.className = 'owner-dot'; flag.style.cssText = 'position:absolute;top:1px;left:2px;font-size:9px'; el.appendChild(flag); }
        flag.textContent = p ? p.emoji : '';
        const hv = g.houses[i] || 0;
        let hEl = el.querySelector('.house');
        if (hv > 0) {
          if (!hEl) { hEl = document.createElement('span'); hEl.className = 'house'; el.appendChild(hEl); }
          hEl.textContent = [' ', '🛖', '🏪', '🏨'][hv];
        } else if (hEl) hEl.remove();
      } else { if (flag) flag.remove(); const hEl = el.querySelector('.house'); if (hEl) hEl.remove(); }
    });
  },

  renderTokens() {
    $$('#board .token').forEach(e => e.remove());
    this.tokenEls = {};
    const g = this.game;
    g.players.forEach((p, idx) => {
      const cell = $(`#board .cell[data-i="${p.pos}"]`);
      if (!cell) return;
      const tk = document.createElement('div');
      tk.className = 'token t' + (idx + 1) + (p.bankrupt ? ' bust' : '');
      tk.textContent = p.emoji;
      tk.title = p.name;
      cell.appendChild(tk);
      this.tokenEls[p.key] = tk;
    });
    this.renderMinimap();
  },

  async animateMove(p, path) {
    for (const pos of path) {
      p.pos = pos;
      this.renderTokens();
      await sleep(130);
    }
  },

  /* ---------- 玩家条 / HUD ---------- */
  renderPlayers() {
    const g = this.game;
    $('#players').innerHTML = g.players.map((p, i) => `
      <div class="pcard ${i === g.turnIdx ? 'on' : ''} ${p.bankrupt ? 'dead' : ''}" data-k="${p.key}">
        <span class="pemoji">${p.emoji}</span>
        <div class="pn">${p.name}</div>
        <div class="pc">${fmt(p.cash)}</div>
        <div class="pl">${p.loan > 0 ? '贷 ' + fmt(p.loan) : '净资产 ' + fmt(g.netWorth(p))}</div>
      </div>`).join('');
    $('#roundNo').textContent = `第 ${g.round} 轮`;
    $('#roundMax').textContent = `${g.maxRounds} 轮结算`;
    this.renderHUD();
  },

  renderHUD() {
    const g = this.game;
    const me = g.players.find(p => p.key === this.myKey) || g.players[0];
    const cur = g.current;
    $('#hudCash').textContent = fmt(me.cash);
    $('#hudLoan').textContent = fmt(me.loan);
    const isMe = !cur.bankrupt && cur.key === this.myKey;
    $('#hudTurn').textContent = g.phase === 'end' ? '已结算' : (isMe ? '你的回合 🎲' : `${cur.emoji} ${cur.name} 的回合`);
    $('#hudTurn').classList.toggle('my', isMe);
    const can = isMe && g.canRoll();
    $('#btnRoll').disabled = !can;
    $('#centerBanner').textContent = g.phase === 'decide' ? '要不要买下这块地？' : (isMe ? '轮到你了' : `${cur.name} 行进中…`);
  },

  feed(html, cls) {
    const g = this.game;
    if (g && Array.isArray(g.log)) {
      g.log.unshift({ h: html, c: cls || '' });
      if (g.log.length > 30) g.log.pop();
    }
    const f = $('#feed');
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.innerHTML = html;
    f.prepend(d);
    while (f.children.length > 30) f.lastChild.remove();
  },

  /* ---------- 弹窗 ---------- */
  modal(html) {
    $('#modalCard').innerHTML = html;
    $('#modal').hidden = false;
    return new Promise(res => { this._modalRes = res; });
  },
  closeModal(v = true) {
    $('#modal').hidden = true;
    if (this._modalRes) { const r = this._modalRes; this._modalRes = null; r(v); }
  },

  async cardModal(ev) {                       // 命运/机遇卡
    const isF = ev.deck === 'fortune';
    await this.modal(`
      <div class="m-emoji">${isF ? '❓' : '🎲'}</div>
      <h3>${isF ? '命运' : '机遇'}</h3>
      <div class="m-desc">${ev.text}<br><span style="color:#6D93A5">${ev.desc || ''}</span></div>
      ${ev.amount ? `<div class="m-amt ${ev.amount > 0 ? 'good' : 'bad'}">${ev.amount > 0 ? '+' : ''}${fmt(ev.amount)}</div>` : ''}
      <div class="m-row"><button class="m-btn yes" onclick="UI.closeModal()">知道了</button></div>`);
  },

  async buyModal(tile, p) {
    const afford = p.cash >= tile.price;
    this.modal(`
      <div class="m-emoji">${tile.icon}</div>
      <h3>${tile.name}</h3>
      <div class="m-desc">${GROUPS[tile.group].name} · ${afford ? '无主地产，买吗？' : '现金不够买不起'}</div>
      <div class="m-price">${fmt(tile.price)}</div>
      <div class="m-desc">过路费 ${fmt(Math.round(tile.price * FEE_MULT[0]))}${this.game.ownsGroup(p, tile.group) ? '（同组加成）' : ''} · 升级后更高</div>
      <div class="m-row">
        <button class="m-btn no" id="mBuyNo">放弃</button>
        <button class="m-btn yes" id="mBuyYes" ${afford ? '' : 'disabled style="filter:grayscale(1)"'}>买入</button>
      </div>`);
    return new Promise(res => {
      $('#mBuyYes').onclick = () => { this.closeModal(); res(true); };
      $('#mBuyNo').onclick = () => { this.closeModal(); res(false); };
    });
  },

  async payModal(ev, g) {                     // 过路费结算（同款大弹窗）
    const from = g.players.find(p => p.key === ev.from);
    const to = g.players.find(p => p.key === ev.to);
    const tile = BOARD.find(t => t.name && ev.text.includes(t.name));
    await this.modal(`
      <div class="m-emoji">💸</div>
      <h3>收到过路费</h3>
      <div class="m-desc">${from.emoji} ${from.name} 支付了「${tile ? tile.name : '地产'}」的过路费</div>
      <div class="m-amt ${ev.to === 'me' ? 'good' : 'bad'}">${ev.to === 'me' ? '+' : '−'}${fmt(ev.amount)}</div>
      <div class="m-flow">
        <div class="mf">${from.emoji}<b>${fmt(ev.amount)}</b>${from.name}</div>
        <div class="arrow">⇢</div>
        <div class="mf">${to.emoji}<b style="color:#7CFF9E">实收</b>${to.name}</div>
      </div>
      <div class="m-row"><button class="m-btn yes" onclick="UI.closeModal()">收到了，继续</button></div>`);
  },

  showTile(i) {
    const g = this.game, t = BOARD[i];
    const owner = g.owners[i] != null ? g.players.find(p => p.key === g.owners[i]) : null;
    const lv = g.houses[i] || 0;
    this.modal(`
      <div class="m-emoji">${t.icon}</div>
      <h3>${t.name}</h3>
      <div class="m-desc">${t.type === 'land'
        ? `${GROUPS[t.group].name}组 · 价格 ${fmt(t.price)}<br>过路费 ${fmt(g.rentOf(t, g.current))} · 建筑：${['无', '🛖小贩摊', '🏪茶室', '🏨酒店'][lv]}`
        : (t.desc || '特殊格')}</div>
      ${owner ? `<div class="m-desc">地主：${owner.emoji} ${owner.name}</div>` : ''}
      <div class="m-row"><button class="m-btn yes" onclick="UI.closeModal()">关闭</button></div>`);
  },

  async bankPanel() {
    const g = this.game;
    if (g.phase === 'end') { this.settleModal(); return; }
    if (g.current.key !== this.myKey) { await this.modal(`<h3>🏦 环球银行</h3><div class="m-desc">等你自己的回合才能办理业务</div><div class="m-row"><button class="m-btn yes" onclick="UI.closeModal()">好</button></div>`); return; }
    const me = g.current;
    if (!g.stocks) g.stocks = STOCKS.map(s => ({ id: s.id, price: s.base, prev: s.base }));
    const lands = BOARD.filter(t => t.type === 'land' && g.owners[t.i] === me.key);
    const items = lands.map(t => {
      const canB = g.canBuild(t), canM = g.canMortgage(t.i);
      return `<div class="bank-item"><div><div class="bi-n">${t.icon} ${t.name} ${g.mortgaged && g.mortgaged[t.i] ? '<span class="bi-s">已抵押</span>' : ''}</div>
        <div class="bi-s">价 ${fmt(t.price)} · ${g.ownsGroup(me, t.group) ? '✅ 同组' : GROUPS[t.group].name + '组'}</div></div>
        <div style="display:flex;gap:6px">
          <button data-b="${t.i}" ${canB ? '' : 'disabled'}>${g.houses[t.i] >= CFG.HOUSE_MAX ? '满级' : '盖房 ' + fmt(houseCostOf(t))}</button>
          <button data-m="${t.i}" ${canM ? '' : 'disabled'}>抵押 +${fmt(Math.round(t.price / 2))}</button>
        </div></div>`;
    }).join('') || '<div class="bi-s">还没有地产</div>';
    const need = Math.ceil(me.loan * (1 + CFG.LOAN_INTEREST));

    // 📈 股票市场（每轮波动 + 每轮派息 = 被动现金流）
    const stockItems = STOCKS.map(s => {
      const price = g.stockPrice(s.id);
      const held = (me.holdings && me.holdings[s.id]) || 0;
      const up = price >= s.base;
      const canBuy = me.cash >= price;
      return `<div class="bank-item"><div><div class="bi-n">${s.icon} ${s.name} ${held ? `<span class="bi-s">持 ${held} 股</span>` : ''}</div>
        <div class="bi-s">现价 <b style="color:${up ? '#2F9E63' : '#D64541'}">${fmt(price)}</b> ${up ? '▲' : '▼'} · 股息率 ${(s.div * 100).toFixed(0)}%/年 · 年内每股息约 ${fmt(Math.round(price * s.div))}</div></div>
        <div style="display:flex;gap:6px">
          <button data-buy="${s.id}" ${canBuy && me.cash - price >= 0 ? '' : 'disabled'}>买 1 股</button>
          <button data-sell="${s.id}" ${held > 0 ? '' : 'disabled'}>卖 1 股</button>
        </div></div>`;
    }).join('');

    // 🛡 保险（天灾人祸出险理赔）
    const insItems = INSURANCE.map(d => {
      const active = me.ins && me.ins.id === d.id && me.ins.rounds > 0;
      return `<div class="bank-item"><div><div class="bi-n">${d.icon} ${d.name} ${active ? `<span class="bi-s">生效中 · 剩 ${me.ins.rounds} 轮</span>` : ''}</div>
        <div class="bi-s">保费 ${fmt(d.premium)} · 保 ${d.term} 轮 · 出险赔 ${fmt(d.cover)}</div></div>
        <button data-ins="${d.id}" ${active || me.cash < d.premium ? 'disabled' : ''}>${active ? '已投保' : '投保'}</button></div>`;
    }).join('');

    // 📊 财务报表（穷爸爸富爸爸式）
    const r = g.report(me);
    this.modal(`
      <h3>🏦 环球银行 · 财务中心</h3>
      <div class="m-desc">工资 ${fmt(CFG.SALARY)}/圈 · 贷款利率 10%</div>
      <div class="m-scroll">
      <div class="bank-sec"><h4>📈 股票市场 · 每轮波动，持股每轮领股息（被动现金流）</h4>${stockItems}</div>
      <div class="bank-sec"><h4>🛡 保险 · 天灾人祸出险自动理赔</h4>${insItems}</div>
      <div class="bank-sec"><h4>📊 财务报表</h4>
        <div class="bank-item"><div><div class="bi-n">💼 资产负债</div>
          <div class="bi-s">现金 ${fmt(r.cash)} · 地产 ${fmt(r.land)} · 股票 ${fmt(r.stocks)} · 贷款 ${fmt(r.loan)}</div></div>
          <div style="font-weight:800;color:${r.net >= 0 ? '#7CFF9E' : '#FF9C8F'}">净资产 ${fmt(r.net)}</div></div>
        <div class="bank-item"><div><div class="bi-n">🔄 被动现金流</div>
          <div class="bi-s">股息 ${fmt(r.stats.div || 0)} + 租金入 ${fmt(r.stats.rentIn || 0)} − 保费 ${fmt(r.stats.insCost || 0)}</div></div>
          <div style="font-weight:800;color:${r.passive > 0 ? '#7CFF9E' : '#FF9C8F'}">${r.passive > 0 ? '+' : ''}${fmt(r.passive)}</div></div>
        <div class="bank-item"><div><div class="bi-n">🧾 累计收支</div>
          <div class="bi-s">主动收入 ${fmt(r.activeIn)}（工资+卡牌）· 支出 ${fmt(r.expense)}（租/税/卡牌）</div></div>
          <div>${r.free ? '<span style="color:#7CFF9E;font-weight:800">✅ 跳出老鼠圈</span>' : '<span style="color:#8FB6C7;font-size:11px">被动现金流尚未覆盖支出</span>'}</div></div>
      </div>
      <div class="bank-sec">
        <div class="bank-item"><div><div class="bi-n">💰 贷款余额</div><div class="bi-s">还清需 ${fmt(need)}（含利息）</div></div>
          <button data-repay="1" ${me.loan > 0 && me.cash > 0 ? '' : 'disabled'}>还款</button></div>
        <div class="bank-item"><div><div class="bi-n">💸 缺钱救急</div><div class="bi-s">抵押一块地得半价现金</div></div>
          <button data-mort="1" ${lands.some(t => g.canMortgage(t.i)) ? '' : 'disabled'}>去抵押</button></div>
        <h4>我的地产（${lands.length}）</h4>${items}
      </div>
      </div>
      <div class="m-row"><button class="m-btn yes" onclick="UI.closeModal()">关闭</button></div>`);
    $$('#modalCard [data-b]').forEach(b => b.onclick = () => {
      if (this.remote) { Net.act('build', +b.dataset.b); this.closeModal(); this.feed('已提交盖房申请，等待房主确认', 'ev-sys'); return; }
      const ok = g.build(+b.dataset.b);
      this.renderOwnership(); this.renderPlayers();
      this.feed(ok ? `盖房成功 🏨` : '盖房失败', ok ? 'ev-good' : 'ev-bad');
      this.closeModal(); this.bankPanel();
    });
    $$('#modalCard [data-m]').forEach(b => b.onclick = () => {
      if (this.remote) { Net.act('mortgage', +b.dataset.m); this.closeModal(); this.feed('已提交抵押申请，等待房主确认', 'ev-sys'); return; }
      const ok = g.mortgage(+b.dataset.m);
      this.renderOwnership(); this.renderPlayers();
      this.feed(ok ? '抵押成功，现金到账' : '抵押失败', ok ? 'ev-good' : 'ev-bad');
      this.closeModal(); this.bankPanel();
    });
    const rp = $('#modalCard [data-repay]');
    if (rp) rp.onclick = () => {
      if (this.remote) { Net.act('repay', me.cash); this.closeModal(); this.feed('已提交还款申请，等待房主确认', 'ev-sys'); return; }
      const pay = g.repay(me.cash);
      this.renderPlayers();
      this.feed(pay > 0 ? `还贷 ${fmt(pay)}` : '无需还款', 'ev-sys');
      this.closeModal(); this.bankPanel();
    };
    $$('#modalCard [data-buy]').forEach(b => b.onclick = () => {
      const id = b.dataset.buy;
      if (this.remote) { Net.act('buyStock', id); this.closeModal(); this.feed('已提交买入申请，等待房主确认', 'ev-sys'); return; }
      const cost = g.buyStock(me, id, 1);
      this.renderPlayers(); this.renderHUD();
      if (cost > 0) { const s = STOCKS.find(x => x.id === id); this.feed(`买入 ${s.icon}${s.name} 1股 -${fmt(cost)}`, 'ev-sys'); }
      else this.feed('现金不足', 'ev-bad');
      this.closeModal(); this.bankPanel();
    });
    $$('#modalCard [data-sell]').forEach(b => b.onclick = () => {
      const id = b.dataset.sell;
      if (this.remote) { Net.act('sellStock', id); this.closeModal(); this.feed('已提交卖出申请，等待房主确认', 'ev-sys'); return; }
      const gain = g.sellStock(me, id, 1);
      this.renderPlayers(); this.renderHUD();
      if (gain > 0) { const s = STOCKS.find(x => x.id === id); this.feed(`卖出 ${s.icon}${s.name} 1股 +${fmt(gain)}`, 'ev-good'); }
      this.closeModal(); this.bankPanel();
    });
    $$('#modalCard [data-ins]').forEach(b => b.onclick = () => {
      const id = b.dataset.ins;
      if (this.remote) { Net.act('buyIns', id); this.closeModal(); this.feed('已提交投保申请，等待房主确认', 'ev-sys'); return; }
      const ok = g.buyInsurance(me, id);
      this.renderPlayers();
      if (ok) { const d = INSURANCE.find(x => x.id === id); this.feed(`投保 ${d.icon}${d.name} -${fmt(d.premium)}`, 'ev-sys'); }
      else this.feed('现金不足或已有同款保险', 'ev-bad');
      this.closeModal(); this.bankPanel();
    });
  },

  async settleModal() {
    const g = this.game;
    const s = g.standings();
    const champ = s[0];
    this.modal(`
      <div class="m-emoji">${champ.emoji}</div>
      <h3>${champ.name} 获胜！</h3>
      <div class="m-desc">按净资产排名 · 共 ${g.round > g.maxRounds ? g.maxRounds : g.round} 轮</div>
      <table class="rank-table">${s.map((p, i) => `
        <tr class="${i === 0 ? 'r1' : ''}">
          <td>${p.emoji} ${p.name}<br><span style="color:#6D93A5;font-size:11px">现金 ${fmt(p.cash)} · 地 ${p.lands} 块${p.loan ? ' · 贷 ' + fmt(p.loan) : ''}${p.bankrupt ? ' · 已破产' : ''}</span></td>
          <td>${fmt(p.worth)}</td></tr>`).join('')}</table>
      <div class="m-row">
        <button class="m-btn no" id="mShare">分享战绩</button>
        <button class="m-btn yes" id="mAgain">再来一局</button>
      </div>`);
    $('#mAgain').onclick = () => location.reload();
    $('#mShare').onclick = async () => {
      const txt = `环马大富翁：${champ.name} 获胜！净资产 ${fmt(champ.worth)} 🇲🇾`;
      try { await navigator.clipboard.writeText(txt); this.feed('战绩已复制，去粘贴给朋友', 'ev-sys'); }
      catch (e) { this.feed(txt, 'ev-sys'); }
      this.closeModal();
    };
  },

  /* ---------- 工具条：缩放/找我/小地图 ---------- */
  applyZoom() {
    $('#board').style.width = (this.baseSize * this.zoom) + 'px';   // 缩放=改画布宽度（grid 自适应）
  },
  setZoom(z) { this.zoom = Math.min(1.8, Math.max(0.3, z)); this.applyZoom(); },
  fit() {   // 看全图：整张地图缩进视口
    const w = $('#boardWrap');
    this.setZoom(Math.min((w.clientWidth - 8) / this.baseSize, (w.clientHeight - 8) / this.baseSize));
  },
  findMe() {
    const p = this.game.players.find(x => x.key === this.myKey) || this.game.players[0];
    const cell = $(`#board .cell[data-i="${p.pos}"]`);
    if (this.zoom < 0.75) this.setZoom(1);
    if (cell) {
      cell.classList.add('hi'); setTimeout(() => cell.classList.remove('hi'), 1200);
      cell.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    }
  },
  renderMinimap() {   // 小地图：金点=我（按真实环形布局映射 8×8）
    const mm = $('#minimap');
    if (mm.hidden || !this.game) return;
    mm.style.top = ($('#boardWrap').getBoundingClientRect().top + 8) + 'px';   // fixed：浮在棋盘区左上
    const g = this.game;
    const slots = new Array(64).fill('<i></i>');
    for (let i = 0; i < N; i++) {
      const { r, c } = this.cellPos(i);
      const meHere = g.players.some(p => !p.bankrupt && p.pos === i && p.key === this.myKey);
      const t = BOARD[i];
      const bg = t.type === 'land' ? ` style="background:${GROUPS[t.group].color}"` : '';
      slots[(r - 1) * 8 + (c - 1)] = `<i class="${meHere ? 'me' : ''}"${meHere ? '' : bg}></i>`;
    }
    mm.innerHTML = `<div class="mm-grid">${slots.join('')}</div>`;
  },
  toggleMinimap() {
    const mm = $('#minimap');
    mm.hidden = !mm.hidden;
    this.renderMinimap();
  },
};
