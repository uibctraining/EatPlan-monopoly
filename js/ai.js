/* EatPlan-monopoly · 电脑玩家决策 */
'use strict';

const AI = {
  /* 落到无主地：买不买 */
  buy(g, p, tile) {
    if (p.cash - tile.price < CFG.BUY_KEEP && tile.price > 150) return false;
    if (p.cash < tile.price) return false;
    // 同组已占一半以上 → 必买
    const mates = BOARD.filter(t => t.type === 'land' && t.group === tile.group && t.i !== tile.i);
    const owned = mates.filter(t => g.owners[t.i] === p.key).length;
    if (owned >= 1 && p.cash - tile.price >= 150) return true;
    return p.cash - tile.price >= CFG.BUY_KEEP || (tile.price <= 120 && p.cash > tile.price + 150);
  },

  /* 回合内的盖房策略（返回要建的 tileIndex 或 null） */
  planBuild(g, p) {
    const groups = {};
    for (const t of BOARD) {
      if (t.type !== 'land') continue;
      if (g.owners[t.i] !== p.key) continue;
      (groups[t.group] = groups[t.group] || []).push(t);
    }
    const cands = [];
    for (const k in groups) {
      if (g.ownsGroup(p, k) && groups[k].length) cands.push(...groups[k]);
    }
    if (!cands.length) return null;
    // 优先盖「离起点近的」（更容易被踩到）
    cands.sort((a, b) => a.i - b.i);
    for (const t of cands) {
      if ((g.houses[t.i] || 0) < CFG.HOUSE_MAX && p.cash - houseCostOf(t) > 400) return t.i;
    }
    return null;
  },

  /* 缺钱时自动抵押（返回 tileIndex 或 null）*/
  planMortgage(g, p) {
    if (p.cash >= 0) return null;
    const mine = BOARD.filter(t => t.type === 'land' && g.owners[t.i] === p.key && g.canMortgage(t.i));
    if (!mine.length) return null;
    mine.sort((a, b) => a.price - b.price); // 先抵押便宜的
    return mine[0].i;
  }
};
