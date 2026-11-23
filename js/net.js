/* EatPlan-monopoly · 联机（房主权威 + REST 轮询，配合 wp ep-monopoly mu-plugin） */
'use strict';

const Net = {
  // 联机房间服务地址：同域部署留空（window.EP_MONO_API=''），跨域时在页面顶部配置：
  base: ((typeof window !== 'undefined' && window.EP_MONO_API) || '') + '/wp-json/ep-mono/v1/room',
  online: false,     // 联机模式开关（单机=false，全部短路）
  isHost: false,
  code: null, token: null, mySeat: -1, myKey: null,
  wait: null,        // 当前广播中的等待指令 {kind, seat, ...}
  _waiters: [],      // host 端等待 act 的 Promise
  _poll: null, _loop: null, _sig: 0,

  async call(op, extra = {}) {
    const res = await fetch(this.base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, code: this.code, token: this.token, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
    return data;
  },

  async create(name, emoji) {
    const d = await this.call('create', { name, emoji });
    this.code = d.code; this.token = d.token; this.mySeat = d.seat;
    this.isHost = true; this.online = true; this.myKey = 'me';
    return d;
  },
  async join(code, name, emoji) {
    const d = await this.call('join', { code, name, emoji });
    this.code = d.code; this.token = d.token; this.mySeat = d.seat;
    this.isHost = false; this.online = true; this.myKey = 'p' + (d.seat + 1);
    return d;
  },

  /* ---- host ---- */
  async start(game) {
    await this.call('start', { state: this.snap(game), wait: null });
    this.hostLoop();
  },
  pushState(game, wait) {
    if (!this.online || !this.isHost) return;
    let state; try { state = this.snap(game); } catch (e) { return; }
    this.wait = wait || null;
    if (wait) this._sig++;
    // 串行队列：并发 fire-and-forget 会乱序到达，旧 wait 可能覆盖新 wait（如 buy 决策指令丢失）
    const body = { state, wait: this.wait };
    this._pushQ = (this._pushQ || Promise.resolve())
      .then(() => this.call('state', body))
      .catch(() => {});
  },
  snap(game) { return JSON.parse(JSON.stringify(game)); },
  waitAct(seat, kind) {
    return new Promise(res => this._waiters.push({ seat, kind, res }));
  },
  _deliver(a) {
    const w = this._waiters.find(x => x.seat === a.seat && x.kind === a.t);
    if (w) {
      this._waiters = this._waiters.filter(x => x !== w);
      w.res(a);
      return true;
    }
    return false;
  },
  /* host 动作队列：按前缀顺序消费，未就绪的停下等下轮 */
  async hostLoop() {
    if (this._loop) return;
    this._loop = (async () => {
      while (this.online && this.isHost) {
        try {
          const r = await this.call('get');
          const acts = (r && r.acts) || [];
          let i = 0, maxAck = 0;
          while (i < acts.length) {
            const a = acts[i];
            let done = this._deliver(a);
            if (!done && window.applyRemoteAct) done = window.applyRemoteAct(a);
            if (!done) break;
            maxAck = a.seq; i++;
          }
          if (maxAck) this.call('ack', { upto: maxAck }).catch(() => {});
        } catch (e) { /* 网络抖动，下轮重试 */ }
        await new Promise(r => setTimeout(r, 1500));
      }
      this._loop = null;
    })();
  },

  /* ---- guest ---- */
  guestLoop(onState) {
    this.stopPoll();
    const tick = async () => {
      try { const r = await this.call('get'); if (r) onState(r); } catch (e) {}
    };
    tick();
    this._poll = setInterval(tick, 2000);
  },
  stopPoll() { if (this._poll) { clearInterval(this._poll); this._poll = null; } },

  async act(t, v) {
    if (!this.online || this.isHost) return;
    try { await this.call('act', { t, v: v == null ? null : v }); } catch (e) {}
  },

  stop() {
    this.stopPoll();
    this.online = false;
    this._waiters.forEach(w => w.res(null));
    this._waiters = [];
  },
  leave() {
    if (!this.online || !this.code) return;
    try {   // keepalive fetch：页面卸载也可发出，且带 JSON Content-Type（sendBeacon 默认 text/plain 会被 WP 拒）
      fetch(this.base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'leave', code: this.code, token: this.token }), keepalive: true }).catch(() => {});
    } catch (e) { /* 忽略 */ }
    this.stop();
  },
};
