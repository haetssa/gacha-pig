// 온라인 대결 동기화.
// - 방장(HostSession): 게임 전체(폭탄, 폭발, 블록, 아이템, 피격, 봇)를 판정하고 초당 10번 상태를 보낸다.
// - 참가자(ClientSession): 자기 돼지만 자기 기기에서 직접 움직이고(조작 지연 없음), 위치와 버튼 누른 횟수를 보낸다.
//   나머지는 방장 상태를 받아 그대로 그린다(다른 돼지는 부드럽게 따라가게 보간).
// link = Online(Firebase) 또는 테스트용 가짜 연결. 필요한 메서드:
//   방장: setSnap, pushEvents, watchInputs   /   참가자: watchSnap, watchEvents, sendInput
import { DIRS } from '../game.js';

const FACES = ['up', 'down', 'left', 'right'];
const KINDS = ['c', 'h', 'v'];
const ITEM_T = ['bomb', 'fire', 'speed'];
const SNAP_MS = 100;   // 방장 → 모두 (초당 10회)
const INPUT_MS = 66;   // 참가자 → 방장 (초당 15회, 바뀐 경우만)
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;
const dirIdx = d => FACES.findIndex(k => DIRS[k][0] === d[0] && DIRS[k][1] === d[1]);

export function encodeSnap(g) {
  return {
    t: r2(g.time),
    r: g.ready === Infinity ? -1 : r2(Math.max(0, g.ready)),
    rv: g.reveal ? 1 : 0,
    o: g.over ? 1 : 0,
    w: g.winner ? g.winner.id : -1,
    g: g.grid.map(row => row.join('')).join(''),
    it: [...g.items].map(([k, t]) => { const [x, y] = k.split(',').map(Number); return [x, y, ITEM_T.indexOf(t)]; }),
    b: g.bombs.map(b => [b.id, r2(b.x), r2(b.y), b.tx, b.ty, r2(b.z || 0), b.flying ? 1 : 0, r2(b.timer), b.owner.id, b.range]),
    f: [...g.flames].map(([k, f]) => { const [x, y] = k.split(',').map(Number); return [x, y, KINDS.indexOf(f.kind), f.end ? 1 : 0, f.dir ? dirIdx(f.dir) : -1, r2(f.until - g.time)]; }),
    p: g.players.map(p => [r3(p.x), r3(p.y), FACES.indexOf(p.facing), p.moving ? 1 : 0, p.alive ? 1 : 0, p.lives,
      p.maxBombs, p.range, p.speedLv, p.items.speed, r2(p.skillReadyAt - g.time), r2(Math.max(0, p.invulnUntil - g.time)),
      p.alive ? 0 : r2(g.time - p.deadAt), p.activeBombs]),
  };
}

export class HostSession {
  constructor(game, link) {
    this.g = game; this.link = link;
    this.events = []; this.acc = SNAP_MS;
    this.byUid = new Map(game.players.filter(p => p.remote).map(p => [p.uid, p]));
    for (const p of this.byUid.values()) Object.assign(p, { netB: 0, netK: 0, qB: 0, qK: 0 });
    link.watchInputs(all => this.onInputs(all));
  }

  onInputs(all) {
    for (const [uid, inp] of Object.entries(all)) {
      const p = this.byUid.get(uid);
      if (!p || !inp || !p.alive) continue;
      if (typeof inp.x === 'number' && typeof inp.y === 'number') { p.x = inp.x; p.y = inp.y; }
      if (FACES[inp.f]) p.facing = FACES[inp.f];
      p.moving = !!inp.m;
      if ((inp.b | 0) > p.netB) { p.qB += (inp.b | 0) - p.netB; p.netB = inp.b | 0; }
      if ((inp.k | 0) > p.netK) { p.qK += (inp.k | 0) - p.netK; p.netK = inp.k | 0; }
    }
  }

  // 원격 참가자의 버튼 입력을 한 번씩 꺼내 게임에 넘긴다
  remoteInput(p) {
    const o = { bomb: p.qB > 0, skill: p.qK > 0 };
    if (p.qB > 0) p.qB--;
    if (p.qK > 0) p.qK--;
    return o;
  }

  ev(e) { this.events.push(e); }

  tick(dt, inputFor) {
    this.g.update(dt, inputFor);
    for (const p of this.byUid.values()) if (p.moving && p.alive) p.bob += dt * 12;
    this.acc += dt * 1000;
    if (this.acc >= SNAP_MS) { this.acc = 0; this.flush(); }
  }

  flush() {
    if (this.events.length) { this.link.pushEvents(this.events); this.events = []; }
    this.link.setSnap(encodeSnap(this.g));
  }

  // 참가자가 나가거나 연결이 끊김 → 그 돼지는 탈락
  playerLeft(uid, name) {
    const p = this.byUid.get(uid);
    if (!p || !p.alive) return;
    p.alive = false; p.deadAt = this.g.time;
    this.g.hooks.toast?.(`${name}님이 나갔어요`);
  }
}

export class ClientSession {
  constructor(game, link, myIdx, hooks = {}) {
    this.g = game; this.link = link; this.hooks = hooks;
    this.me = game.players[myIdx];
    this.bombs = new Map();        // id -> 폭탄 객체 (같은 객체를 유지해야 통과 권한이 이어짐)
    this.b = 0; this.k = 0;        // 폭탄/스킬 누른 횟수
    this.acc = 0; this.last = ''; this.ended = false; this.gotSnap = false;
    game.bombs = []; game.flames = new Map(); game.items = new Map();
    for (const p of game.players) { p.nx = p.x; p.ny = p.y; }
    link.watchSnap(s => this.applySnap(s));
    link.watchEvents(evs => this.applyEvents(evs));
  }

  applySnap(s) {
    const g = this.g;
    this.gotSnap = true;
    g.time = s.t;
    g.ready = s.r < 0 ? Infinity : s.r;
    g.reveal = !!s.rv;
    if (s.g && s.g.length === g.cols * g.rows) {
      let i = 0;
      for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) g.grid[y][x] = s.g.charCodeAt(i++) - 48;
    }
    g.items = new Map((s.it || []).map(([x, y, t]) => [x + ',' + y, ITEM_T[t]]));

    const seen = new Set();
    for (const [id, x, y, tx, ty, z, fly, timer, owner, range] of (s.b || [])) {
      seen.add(id);
      let b = this.bombs.get(id);
      const isNew = !b;
      if (isNew) {
        b = { id, x, y, tx, ty, z, owner: g.players[owner], timer, range, pierce: false, flying: null, t0: g.time, sx: x, sy: y };
        this.bombs.set(id, b);
      }
      const landed = !!b.flying && !fly;
      b.tx = tx; b.ty = ty; b.z = z; b.timer = timer; b.range = range; b.sx = x; b.sy = y;
      b.flying = fly ? (b.flying || {}) : null;
      if (!fly) { b.x = tx; b.y = ty; }
      // 내 돼지가 걸쳐 있는 칸에 폭탄이 생기면(설치/착지) 빠져나갈 수 있게
      if (!fly && (isNew || landed) && this.me.alive && g.overlapsTile(this.me, tx, ty)) this.me.passBombs.add(b);
    }
    for (const id of [...this.bombs.keys()]) if (!seen.has(id)) this.bombs.delete(id);
    g.bombs = [...this.bombs.values()];

    g.flames = new Map((s.f || []).map(([x, y, k, end, d, rel]) =>
      [x + ',' + y, { kind: KINDS[k], end: !!end, dir: d >= 0 ? DIRS[FACES[d]] : null, until: g.time + rel }]));

    (s.p || []).forEach((a, i) => {
      const p = g.players[i];
      if (!p) return;
      const [x, y, f, m, alive, lives, mb, range, sl, spd, skRel, invRel, deadAgo, ab] = a;
      p.alive = !!alive; p.lives = lives; p.maxBombs = mb; p.range = range; p.speedLv = sl; p.items.speed = spd;
      p.skillReadyAt = g.time + skRel; p.invulnUntil = g.time + invRel; p.activeBombs = ab;
      if (!p.alive) p.deadAt = g.time - deadAgo;
      if (p === this.me) {
        // 내 위치는 내 기기가 기준. 방장과 크게 어긋날 때만(죽음/동기화 오류) 맞춘다
        if (!p.alive || Math.hypot(x - p.x, y - p.y) > 2.5) { p.x = x; p.y = y; }
        return;
      }
      p.nx = x; p.ny = y; p.facing = FACES[f] || p.facing; p.moving = !!m;
    });

    if (s.o && !this.ended) {
      this.ended = true; g.over = true;
      g.winner = s.w >= 0 ? g.players[s.w] : null;
      this.hooks.onEnd?.(g.winner);
    }
  }

  applyEvents(evs) {
    const g = this.g;
    for (const e of evs) {
      if (e[0] === 's') { this.hooks.sfx?.(e[1]); if (e[1] === 'boom') g.shake = 0.18; }
      else if (e[0] === 'fl') g.floats.push({ x: e[1], y: e[2], text: e[3], color: e[4], t0: g.time });
      else if (e[0] === 'fx') { const fx = e[1]; if (fx.k === 'debris') g.debris(fx.x, fx.y, fx.color); else g.fx.push({ ...fx, t0: g.time }); }
      else if (e[0] === 'to') this.hooks.toast?.(e[1]);
    }
  }

  // inp = { dir, bomb, skill } (내 기기의 조작)
  tick(dt, inp) {
    const g = this.g, me = this.me;
    if (g.ready === Infinity || g.over) { me.moving = false; return; }
    g.time += dt;
    g.shake = Math.max(0, g.shake - dt);
    for (const [k, f] of g.flames) if (f.until <= g.time) g.flames.delete(k);
    for (const b of me.passBombs) if (!this.bombs.has(b.id) || !g.overlapsTile(me, b.tx, b.ty)) me.passBombs.delete(b);

    let action = false;
    if (me.alive && g.ready <= 0) {
      g.movePlayer(me, inp.dir, dt);
      if (inp.bomb) { this.b++; action = true; }
      if (inp.skill) { this.k++; action = true; }
    } else me.moving = false;

    const k = Math.min(1, dt * 15);
    for (const p of g.players) {
      if (p === me) continue;
      p.x += (p.nx - p.x) * k; p.y += (p.ny - p.y) * k;
      if (p.moving && p.alive) p.bob += dt * 12;
    }
    for (const b of g.bombs) if (b.flying) { b.x += (b.sx - b.x) * k; b.y += (b.sy - b.y) * k; }

    this.acc += dt * 1000;
    const msg = { x: r3(me.x), y: r3(me.y), f: FACES.indexOf(me.facing), m: me.moving ? 1 : 0, b: this.b, k: this.k };
    const key = JSON.stringify(msg);
    if (action || (this.acc >= INPUT_MS && key !== this.last)) {
      this.acc = 0; this.last = key;
      this.link.sendInput(msg);
    }
  }
}
