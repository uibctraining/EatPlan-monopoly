/* EatPlan-monopoly · 游戏引擎（纯逻辑，不碰 DOM） */
'use strict';

class Game {
  constructor(opts = {}) {
    this.maxRounds = opts.maxRounds || CFG.MAX_ROUNDS;
    this.round = 1;
    this.turnIdx = 0;
    this.phase = 'roll';            // roll | decide | end
    this.dice = [0, 0];
    this.doubles = 0;
    this.owners = {};               // tileIndex -> player.key
    this.houses = {};               // tileIndex -> 0..3
    this.log = [];
    this.winner = null;
    const keys = opts.players && opts.players.length ? opts.players : ['me', 'fox', 'tiger'];
    this.players = keys.map((k, idx) => {
      const r = ROSTER[k] || ROSTER.me;
      return {
        key: k, name: r.name, emoji: r.emoji, color: r.color,
        cash: CFG.CASH, pos: 0, rest: 0, loan: 0,
        bankrupt: false, isAI: idx > 0, tax: false
      };
    });
  }

  get current() { return this.players[this.turnIdx]; }
  get alive() { return this.players.filter(p => !p.bankrupt); }
  tile(i) { return BOARD[((i % N) + N) % N]; }

  netWorth(p) {
    let v = p.cash - p.loan;
    for (const t of BOARD) {
      if (t.type !== 'land') continue;
      if (this.owners[t.i] === p.key) {
        v += t.price;
        v += (this.houses[t.i] || 0) * houseCostOf(t);
      }
    }
    return Math.max(0, Math.round(v));
  }

  ownsGroup(p, group) {
    return BOARD.filter(t => t.type === 'land' && t.group === group)
      .every(t => this.owners[t.i] === p.key);
  }

  rentOf(t, debtor) {
    const lv = this.houses[t.i] || 0;
    let fee = t.price * FEE_MULT[lv];
    const owner = this.players.find(p => p.key === this.owners[t.i]);
    if (owner && this.ownsGroup(owner, t.group)) fee *= CFG.PASS_GROUP_MULT;
    return Math.round(fee);
  }

  canRoll() { return this.phase === 'roll' && !this.winner && !!this.current && !this.current.bankrupt; }

  /* 掷骰 → 移动 → 落地结算。返回事件序列；无主地时 phase='decide' 等待决策 */
  roll() {
    if (this.phase !== 'roll') return null;
    const p = this.current;
    const a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6);
    this.dice = [a, b];
    const isDouble = a === b;
    const events = [];
    let path = [];

    if (p.rest > 0) {
      if (!isDouble) {
        p.rest -= 1;
        events.push({ type: 'rest', text: p.rest > 0 ? `还在茶餐室歇着（剩 ${p.rest} 回合）` : '歇好了，下回合出发' });
        this.phase = 'roll';
        return { dice: [a, b], path: [], events, needBuy: null, ended: true };
      }
      p.rest = 0;
      events.push({ type: 'restGo', text: '掷到双数！休息结束，出发 🎉' });
    } else {
      if (isDouble) this.doubles += 1; else this.doubles = 0;
      if (this.doubles >= 3) { // 连续三次双数 → 休息
        this.doubles = 0; p.rest = CFG.REST_TURNS;
        events.push({ type: 'rest', text: '连续三次双数，司机疲劳驾驶，请到茶餐室歇一回合 ☕' });
        this.phase = 'roll';
        return { dice: [a, b], path: [], events, needBuy: null, ended: true };
      }
      const steps = a + b;
      path = this.moveBy(p, steps, events);
    }

    // 落地结算（卡牌可能再次位移，限深）
    let depth = 0, needBuy = null;
    while (depth < 4) {
      const t = this.tile(p.pos);
      const r = this.resolve(p, t, events);
      if (r === 'decide') { needBuy = t; break; }
      if (r !== 'again') break;
      depth++;
    }
    if (this.checkBankrupt(p, events)) needBuy = null;

    if (needBuy) this.phase = 'decide';
    else this.phase = 'roll';
    return { dice: [a, b], path, events, needBuy, ended: false, double: isDouble };
  }

  moveBy(p, steps, events) {
    const path = [];
    let pos = p.pos;
    for (let k = 0; k < steps; k++) {
      pos = (pos + 1) % N;
      path.push(pos);
      if (pos === 0) {
        p.cash += CFG.SALARY;
        events.push({ type: 'salary', text: `经过 KLIA 领工资 +RM${CFG.SALARY}`, amount: CFG.SALARY });
      }
    }
    p.pos = pos;
    return path;
  }

  /* 落地处理。返回 'decide' | 'again' | 'done' */
  resolve(p, t, events) {
    if (t.type === 'land') {
      const owner = this.players.find(x => x.key === this.owners[t.i]);
      if (!owner) return 'decide';
      if (owner.key === p.key) return 'done';
      const fee = this.rentOf(t, p);
      this.pay(p, owner, fee);
      events.push({ type: 'rent', to: owner.key, from: p.key, amount: fee,
        text: `${t.name} 过路费 RM${fee} → ${owner.name}` });
      return 'done';
    }
    if (t.type === 'sst') {
      const amt = Math.max(10, Math.round(p.cash * CFG.TAX_PCT));
      p.cash -= amt;
      events.push({ type: 'tax', amount: amt, text: `SST 消费税：付 RM${amt} 🧾` });
      return this.checkBankrupt(p, events) ? 'done' : 'done';
    }
    if (t.type === 'tax') {
      const amt = Math.min(CFG.TAX_FLAT, Math.max(0, p.cash));
      p.cash -= amt;
      events.push({ type: 'tax', amount: amt, text: `所得税：付 RM${amt} 💰` });
      return 'done';
    }
    if (t.type === 'rest') {
      p.rest = CFG.REST_TURNS;
      events.push({ type: 'rest', text: '到茶餐室歇一回合 ☕ 下回合掷双可提前走' });
      return 'done';
    }
    if (t.type === 'fortune' || t.type === 'chance') {
      const deck = t.type === 'fortune' ? FORTUNE : CHANCE;
      const c = deck[Math.floor(Math.random() * deck.length)];
      const ev = { type: 'card', deck: t.type, text: c.t, desc: c.d };
      if (c.cash) {
        p.cash += c.cash;
        ev.amount = c.cash;
        ev.text = c.t + (c.cash > 0 ? `（+RM${c.cash}）` : `（-RM${-c.cash}）`);
      }
      if (c.move !== undefined) {
        p.pos = c.move;
        ev.text += ` → 前往「${this.tile(c.move).name}」`;
        events.push(ev);
        return 'again';
      }
      if (c.back !== undefined) {
        p.pos = (p.pos - c.back + N) % N;
        ev.text += ` → 退回 ${this.tile(p.pos).name}`;
        events.push(ev);
        return 'again';
      }
      events.push(ev);
      this.checkBankrupt(p, events);
      return 'done';
    }
    return 'done'; // start
  }

  pay(from, to, amt) {
    const real = Math.min(amt, Math.max(0, from.cash));
    from.cash -= real;
    to.cash += real;
    if (real < amt) from.loan += 0; // 缺口由破产判定处理
  }

  checkBankrupt(p, events) {
    if (p.cash >= 0 || p.bankrupt) return false;
    p.bankrupt = true;
    for (const t of BOARD) {
      if (this.owners[t.i] === p.key) { delete this.owners[t.i]; delete this.houses[t.i]; }
    }
    events.push({ type: 'bankrupt', text: `${p.name} 破产出局 💸` });
    if (this.alive.length === 1) this.finish(this.alive[0]);
    return true;
  }

  /* 买地决策（decide 阶段） */
  decideBuy(yes) {
    if (this.phase !== 'decide') return false;
    const p = this.current, t = this.tile(p.pos);
    if (yes && p.cash >= t.price) {
      p.cash -= t.price;
      this.owners[t.i] = p.key;
      this.houses[t.i] = 0;
      this.log.push(`${p.name} 买下 ${t.name} RM${t.price}`);
    } else {
      this.log.push(`${p.name} 放弃 ${t.name}`);
    }
    this.phase = 'roll';
    return true;
  }

  /* 盖房（须同组集齐、地无抵押、现金足够） */
  canBuild(t) {
    if (!t || t.type !== 'land') return false;
    const p = this.current;
    if (this.owners[t.i] !== p.key) return false;
    if (!this.ownsGroup(p, t.group)) return false;
    if ((this.houses[t.i] || 0) >= CFG.HOUSE_MAX) return false;
    return p.cash >= houseCostOf(t);
  }
  build(i) {
    const t = this.tile(i);
    if (!this.canBuild(t)) return false;
    this.current.cash -= houseCostOf(t);
    this.houses[i] = (this.houses[i] || 0) + 1;
    this.log.push(`${this.current.name} 在 ${t.name} 升级 ${['小贩摊', '茶室', '酒店'][this.houses[i] - 1]}`);
    return true;
  }

  /* 抵押（得地价一半）/ 还贷（本金+10%） */
  mortgage(i) {
    const t = this.tile(i), p = this.current;
    if (!t || t.type !== 'land' || this.owners[i] !== p.key || (this.houses[i] || 0) > 0) return false;
    if (this.mortgaged && this.mortgaged[i]) return false;
    p.cash += Math.round(t.price / 2);
    this.mortgaged = this.mortgaged || {};
    this.mortgaged[i] = true;
    return true;
  }
  canMortgage(i) {
    const t = this.tile(i);
    return !!(t && t.type === 'land' && this.owners[i] === this.current.key
      && (this.houses[i] || 0) === 0 && !(this.mortgaged && this.mortgaged[i]));
  }
  repay(amount) {
    const p = this.current;
    const need = Math.ceil(p.loan * (1 + CFG.LOAN_INTEREST));
    const pay = Math.min(amount, p.cash, need);
    if (pay <= 0) return 0;
    p.cash -= pay;
    p.loan = Math.max(0, p.loan - Math.round(pay / (1 + CFG.LOAN_INTEREST)));
    if (p.loan === 0 && p.loan !== undefined) { /* 清账 */ }
    return pay;
  }

  /* 结束当前玩家回合 → 下一位 */
  endTurn() {
    if (this.winner) return;
    this.doubles = 0;
    this.phase = 'roll';
    if (this.alive.length === 1 && this.players.length > 1) { this.finish(this.alive[0]); return; }
    let guard = 0;
    do {
      this.turnIdx = (this.turnIdx + 1) % this.players.length;
      if (this.turnIdx === 0) {
        this.round += 1;
        if (this.round > this.maxRounds) { this.finishByNetWorth(); return; }
      }
      guard++;
    } while (this.current.bankrupt && guard < 50);
  }

  finish(w) { this.winner = w.key; this.phase = 'end'; this.standings_ = this.standings(); }
  finishByNetWorth() {
    const s = this.standings();
    this.winner = s[0].key; this.phase = 'end'; this.standings_ = s;
  }
  standings() {
    return [...this.players].sort((a, b) => this.netWorth(b) - this.netWorth(a))
      .map(p => ({ key: p.key, name: p.name, emoji: p.emoji, cash: p.cash, loan: p.loan,
        worth: this.netWorth(p), bankrupt: p.bankrupt,
        lands: BOARD.filter(t => t.type === 'land' && this.owners[t.i] === p.key).length }));
  }
}
