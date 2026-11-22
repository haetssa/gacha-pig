// 게임 규칙/상태. 화면(DOM)과 무관한 순수 로직이라 Node에서도 돌릴 수 있다.
//
// 좌표: p.x, p.y 는 "칸 단위 실수"(정수 = 칸 중심). 돼지는 칸 사이 어디에서나 멈출 수 있다(자유 이동).
// 블록/폭탄/불꽃은 칸 단위. 돼지가 "서 있는 칸" = 몸 중심이 있는 칸(반올림) — 폭탄 설치, 피격, 아이템 줍기 기준.
// 충돌: 돼지를 반폭 HALF인 정사각형 상자로 보고 막힌 칸과 겹치지 않게 움직인다.
//       막혔을 때 열린 길 쪽으로 걸쳐 있으면 옆으로 미끄러뜨려 통로에 맞춰준다(모서리 보정).
import { PIGS, PERKS, ITEMS } from './data.js';

export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const CELL = { EMPTY: 0, WALL: 1, HAY: 2, CRATE: 3 };
const { EMPTY, WALL, HAY, CRATE } = CELL;
export const FLAME_TIME = 0.55;
export const HALF = 0.4;      // 돼지 충돌 상자 반폭(칸). 1칸 통로 양옆에 0.1씩 여유
const ASSIST = 0.2;           // 열린 길 쪽으로 이만큼 이상 걸쳐 있으면 그쪽으로 미끄러져 들어감
const SUB = 0.02;             // 충돌 검사 간격(칸)
const DEFAULT_FUSE = 2.4;
const EPS = 1e-6;

export function pickItemType() {
  const r = Math.random() * 100;
  return r < 35 ? 'bomb' : r < 70 ? 'fire' : 'speed';
}

export class Game {
  constructor(map, setups, hooks = {}) {
    this.map = map;
    this.cols = map.cols; this.rows = map.rows;
    this.hooks = hooks;
    this.time = 0;
    this.ready = 0;
    this.reveal = true;   // false인 동안은 얻은 특성을 화면에 안 보여줌 (가챠 연출 중)
    this.timeLimit = map.timeLimit ?? 150;
    this.over = false; this.endAt = null; this.winner = null;
    this.grid = []; this.floorVar = [];
    this.crateItem = new Map();
    this.bombs = [];
    this.flames = new Map();   // "x,y" -> {until, kind:'c'|'h'|'v', end, dir, owner}
    this.items = new Map();    // "x,y" -> itemType
    this.pending = [];         // 불꽃이 꺼지면 나타날 아이템
    this.fx = []; this.floats = []; this.shake = 0;
    this.bombSeq = 0;      // 폭탄 번호 (온라인 동기화용)

    const spawns = {};
    for (let y = 0; y < this.rows; y++) {
      const row = [], fv = [];
      for (let x = 0; x < this.cols; x++) {
        const ch = map.grid[y][x];
        let c = EMPTY;
        if (ch === '#') c = WALL;
        else if (ch === 'B') c = HAY;
        else if (ch === '?') c = Math.random() < (map.fill ?? 0.75) ? HAY : EMPTY;
        else if (ch === 'C') { c = CRATE; this.crateItem.set(x + ',' + y, pickItemType()); }
        else if ('1234'.includes(ch)) spawns[ch] = [x, y];
        row.push(c); fv.push(Math.random());
      }
      this.grid.push(row); this.floorVar.push(fv);
    }
    this.players = setups.map((s, i) => this.makePlayer(s, i, spawns[String(i + 1)]));
  }

  sfx(name) { this.hooks.sfx?.(name); }

  makePlayer(s, i, sp) {
    const pig = PIGS[s.pigId];
    const p = {
      id: i, name: s.name, color: s.color, isBot: !!s.isBot, pig, pigId: s.pigId,
      uid: s.uid || null, remote: !!s.remote,   // remote: 온라인 참가자(위치는 참가자 기기가 보내줌)
      x: sp[0], y: sp[1], moving: false, facing: 'down', bob: 0,
      maxBombs: pig.bombs, range: pig.range, speedLv: 0, baseSpeed: pig.speed, lives: pig.lives,
      fuse: DEFAULT_FUSE, luck: false, pierce: false, activeBombs: 0,
      items: { bomb: 0, fire: 0, speed: 0 },
      passBombs: new Set(),     // 겹쳐 있던 상태에서 생긴 폭탄은 빠져나올 때까지 통과 가능
      alive: true, deadAt: 0, invulnUntil: 0, stunUntil: 0,
      skillReadyAt: pig.passive ? 0 : 1.5,   // 패시브(텟카이)는 처음부터 준비됨
      perk: null, ai: {},
    };
    const perk = PERKS.find(k => k.id === s.perkId);
    if (perk) { perk.apply(p); p.perk = perk; }
    return p;
  }

  // ---------- 조회 ----------
  speedOf(p) { return Math.max(2.2, p.baseSpeed + 0.55 * p.speedLv); }
  inB(x, y) { return x >= 0 && y >= 0 && x < this.cols && y < this.rows; }
  cell(x, y) { return this.inB(x, y) ? this.grid[y][x] : WALL; }
  bombAt(x, y) { return this.bombs.find(b => !b.flying && b.tx === x && b.ty === y); }
  bombLandingAt(x, y) { return this.bombs.some(b => b.flying && b.tx === x && b.ty === y); }
  tileOf(p) { return [Math.round(p.x), Math.round(p.y)]; }
  playerAt(x, y, except) {
    return this.players.find(p => p !== except && p.alive && Math.round(p.x) === x && Math.round(p.y) === y);
  }
  walkable(x, y) { return this.cell(x, y) === EMPTY && !this.bombAt(x, y); }
  flameAt(x, y) { return this.flames.has(x + ',' + y); }

  // 돼지 p 입장에서 지나갈 수 있는 칸인가 (통과 권한이 있는 폭탄은 무시)
  freeFor(p, x, y) {
    if (this.cell(x, y) !== EMPTY) return false;
    const b = this.bombAt(x, y);
    return !b || p.passBombs.has(b);
  }
  // (nx,ny)에 돼지 상자를 두면 막힌 칸과 겹치는가
  boxHits(p, nx, ny) {
    const x0 = Math.floor(nx - HALF - 0.5 + EPS) + 1, x1 = Math.ceil(nx + HALF + 0.5 - EPS) - 1;
    const y0 = Math.floor(ny - HALF - 0.5 + EPS) + 1, y1 = Math.ceil(ny + HALF + 0.5 - EPS) - 1;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (!this.freeFor(p, x, y)) return true;
    return false;
  }
  overlapsTile(p, x, y) { return Math.abs(p.x - x) < 0.5 + HALF - EPS && Math.abs(p.y - y) < 0.5 + HALF - EPS; }
  // 폭탄이 생기는 순간 그 칸에 걸쳐 있던 돼지들은 빠져나갈 수 있게
  grantPass(b) { for (const p of this.players) if (p.alive && this.overlapsTile(p, b.tx, b.ty)) p.passBombs.add(b); }

  // ---------- 메인 업데이트 ----------
  update(dt, inputFor) {
    if (this.over) return;
    if (this.ready > 0) { this.ready -= dt; return; } // 시작 전 준비 시간(가챠 결과 표시): 시간/움직임 정지
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt);

    for (const [k, f] of this.flames) if (f.until <= this.time) this.flames.delete(k);

    this.pending = this.pending.filter(it => {
      if (this.time < it.at) return true;
      if (this.flameAt(it.x, it.y)) return true;
      if (this.cell(it.x, it.y) === EMPTY) this.items.set(it.x + ',' + it.y, it.type);
      return false;
    });

    for (const p of this.players) {
      if (!p.alive) continue;
      for (const b of p.passBombs) if (!this.bombs.includes(b) || !this.overlapsTile(p, b.tx, b.ty)) p.passBombs.delete(b);
      const inp = (inputFor && inputFor(p, dt)) || {};
      const stunned = this.time < p.stunUntil;
      if (!stunned) {
        if (inp.bomb) this.placeBomb(p);
        if (inp.skill) this.useSkill(p);
      }
      if (!p.remote) this.movePlayer(p, stunned ? null : inp.dir, dt, inp.goal);
      const [tx, ty] = this.tileOf(p);
      const k = tx + ',' + ty;
      if (this.items.has(k)) {
        const t = this.items.get(k);
        this.items.delete(k);
        const ok = ITEMS[t].apply(p);
        this.sfx('pickup');
        this.float(p.x, p.y, ok ? ITEMS[t].name : '최대!', ok ? '#fff6a0' : '#d0d0e0');
      }
    }

    const boom = [];
    for (const b of this.bombs) {
      if (b.flying) { this.updateFlight(b, dt); continue; }   // 날아가는 동안은 타이머 정지
      b.timer -= dt;
      if (b.timer <= 0 || this.flameAt(b.tx, b.ty)) boom.push(b);
    }
    for (const b of boom) this.explode(b);

    for (const p of this.players) {
      if (!p.alive) continue;
      const [tx, ty] = this.tileOf(p);
      if (this.flameAt(tx, ty)) this.hit(p, this.flames.get(tx + ',' + ty).owner);
    }

    const alive = this.players.filter(p => p.alive);
    if (this.endAt === null && (alive.length <= 1 || this.time >= this.timeLimit)) this.endAt = this.time + 1.2;
    if (this.endAt !== null && this.time >= this.endAt) {
      const al = this.players.filter(p => p.alive);
      this.winner = al.length === 1 ? al[0] : null;
      this.over = true;
      this.hooks.onEnd?.(this.winner);
    }
  }

  forceEnd(delay = 1.5) { if (this.endAt === null) this.endAt = this.time + delay; }

  // ---------- 이동 (자유 이동 + 모서리 보정) ----------
  // goal: 봇용. 이동 축에서 이 좌표를 넘어가지 않게 멈춘다
  movePlayer(p, dir, dt, goal) {
    p.moving = false;
    if (!dir) return;
    p.facing = dir;
    const [dx, dy] = DIRS[dir];
    let step = this.speedOf(p) * dt;
    if (goal) {
      const remain = dx ? (goal[0] - p.x) * dx : (goal[1] - p.y) * dy;
      if (remain > EPS) step = Math.min(step, remain);
      else if (Math.abs(dx ? goal[1] - p.y : goal[0] - p.x) < EPS) return; // 이미 도착
    }
    let rest = step, moved = 0;
    for (let guard = 0; rest > EPS && guard < 3; guard++) {
      const m = this.moveAxis(p, dx, dy, rest);
      rest -= m; moved += m;
      if (rest <= EPS) break;
      const s = this.cornerSlide(p, dx, dy, rest);
      if (s <= EPS) break;
      rest -= s; moved += s;
    }
    if (moved > 1e-4) {
      p.moving = true; p.bob += dt * 12;
      // 걷는 동안 진행 방향의 옆으로 줄 가운데에 서서히 맞춤 (통로 안에서 몸이 비껴 있지 않게)
      const perp = dx ? p.y : p.x, off = perp - Math.round(perp);
      if (Math.abs(off) > EPS) {
        const n = Math.min(Math.abs(off), moved * 0.6);
        if (dx) this.moveAxis(p, 0, -Math.sign(off), n); else this.moveAxis(p, -Math.sign(off), 0, n);
      }
    }
  }

  // 한 축으로 dist만큼 이동 시도. 막히기 직전까지 가고 실제 이동 거리 반환
  moveAxis(p, ax, ay, dist) {
    let moved = 0;
    while (moved < dist - EPS) {
      const s = Math.min(SUB, dist - moved);
      const nx = p.x + ax * s, ny = p.y + ay * s;
      if (this.boxHits(p, nx, ny)) break;
      p.x = nx; p.y = ny; moved += s;
    }
    return moved;
  }

  // 진행 방향이 막혔을 때: 앞쪽이 열린 줄로 몸을 옆으로 맞춰준다
  cornerSlide(p, dx, dy, rest) {
    const along = dx ? p.x : p.y, perp = dx ? p.y : p.x, d = dx || dy;
    const ahead = Math.round(along + d * (HALF + 0.1));
    const lane = Math.round(perp), off = perp - lane;
    const open = L => (dx ? this.freeFor(p, ahead, L) : this.freeFor(p, L, ahead));
    let target = null;
    if (open(lane) && Math.abs(off) > EPS) target = lane;                          // 지금 줄 앞이 열림 -> 줄 가운데로
    else if (!open(lane) && Math.abs(off) >= ASSIST && open(lane + Math.sign(off))) target = lane + Math.sign(off); // 옆 줄이 열림
    if (target === null) return 0;
    const delta = target - perp;
    const dist = Math.min(rest, Math.abs(delta));
    return dx ? this.moveAxis(p, 0, Math.sign(delta), dist) : this.moveAxis(p, Math.sign(delta), 0, dist);
  }

  // ---------- 폭탄 ----------
  newBomb(p, x, y, tx, ty) {
    return { id: ++this.bombSeq, x, y, tx, ty, z: 0, owner: p, timer: p.fuse, range: p.range, pierce: p.pierce,
      flying: null, dir: null, t0: this.time };
  }

  placeBomb(p) {
    if (p.activeBombs >= p.maxBombs) return false;
    const [x, y] = this.tileOf(p);
    if (this.cell(x, y) !== EMPTY || this.bombAt(x, y) || this.bombLandingAt(x, y)) return false;
    const b = this.newBomb(p, x, y, x, y);
    this.bombs.push(b);
    p.activeBombs++;
    this.grantPass(b);
    this.sfx('place');
    return true;
  }

  // (x,y)에서 (dx,dy) 방향으로 dist칸 앞부터 차례로 보며 처음 나오는 빈칸 (장애물은 넘어감)
  landing(x, y, dx, dy, dist) {
    for (let d = dist; ; d++) {
      const tx = x + dx * d, ty = y + dy * d;
      if (!this.inB(tx, ty)) return null;
      if (this.cell(tx, ty) === EMPTY && !this.bombAt(tx, ty) && !this.bombLandingAt(tx, ty)) return [tx, ty];
    }
  }

  fly(b, target, dur) {
    b.flying = { fx: b.x, fy: b.y, t: 0, dur };
    b.tx = target[0]; b.ty = target[1];
  }

  updateFlight(b, dt) {
    const f = b.flying;
    f.t += dt;
    const k = Math.min(1, f.t / f.dur);
    b.x = f.fx + (b.tx - f.fx) * k;
    b.y = f.fy + (b.ty - f.fy) * k;
    b.z = Math.sin(k * Math.PI) * 14;
    if (k < 1) return;
    b.flying = null; b.z = 0; b.x = b.tx; b.y = b.ty;
    const taken = this.bombs.some(o => o !== b && !o.flying && o.tx === b.tx && o.ty === b.ty);
    if (taken || this.cell(b.tx, b.ty) !== EMPTY) {     // 날아가는 사이에 자리가 찼으면 다음 빈칸으로
      const t = b.dir && this.landing(b.tx, b.ty, b.dir[0], b.dir[1], 1);
      if (t) this.fly(b, t, 0.15); else b.timer = 0;     // 갈 곳이 없으면 그 자리에서 터짐
      return;
    }
    this.grantPass(b);
    this.sfx('place');
  }

  explode(b) {
    if (b.exploded) return;
    b.exploded = true;
    this.bombs = this.bombs.filter(o => o !== b);
    b.owner.activeBombs--;
    const x = Math.round(b.x), y = Math.round(b.y);
    const until = this.time + FLAME_TIME;
    this.setFlame(x, y, 'c', false, until, null, b.owner);
    const chain = [];
    for (const [dx, dy] of Object.values(DIRS)) {
      let lastKey = null;
      for (let r = 1; r <= b.range; r++) {
        const cx = x + dx * r, cy = y + dy * r;
        const c = this.cell(cx, cy);
        if (c === WALL) break;
        const kind = dx ? 'h' : 'v';
        if (c === HAY || c === CRATE) {
          this.destroyBlock(cx, cy, b.owner, FLAME_TIME);
          this.setFlame(cx, cy, kind, false, until, [dx, dy], b.owner);
          lastKey = cx + ',' + cy;
          if (!b.pierce) break;
          continue;
        }
        const ob = this.bombAt(cx, cy);
        if (ob) chain.push(ob);
        this.items.delete(cx + ',' + cy);
        this.setFlame(cx, cy, kind, false, until, [dx, dy], b.owner);
        lastKey = cx + ',' + cy;
      }
      if (lastKey) { const f = this.flames.get(lastKey); if (f && f.kind !== 'c') f.end = true; }
    }
    this.shake = 0.18;
    this.sfx('boom');
    for (const ob of chain) this.explode(ob);
  }

  setFlame(x, y, kind, end, until, dir, owner) {
    const k = x + ',' + y;
    const f = this.flames.get(k);
    if (!f) { this.flames.set(k, { until, kind, end, dir, owner }); return; }
    f.until = Math.max(f.until, until);
    f.owner = owner;
    if (f.kind !== kind) f.kind = 'c';
    f.end = false;
  }

  destroyBlock(x, y, owner, delay) {
    const c = this.cell(x, y);
    if (c !== HAY && c !== CRATE) return;
    this.grid[y][x] = EMPTY;
    let type = null;
    if (c === CRATE) type = this.crateItem.get(x + ',' + y);
    else if (Math.random() < (owner?.luck ? 0.65 : (this.map.itemChance ?? 0.35))) type = pickItemType();
    if (type) this.pending.push({ x, y, type, at: this.time + delay });
    this.debris(x, y, c === CRATE ? '#b5713a' : '#f2c14e');
    this.hooks.fx?.({ k: 'debris', x, y, color: c === CRATE ? '#b5713a' : '#f2c14e' });
    this.sfx('break');
  }

  hit(p, by) {
    if (this.time < p.invulnUntil) return;
    if (p.pigId === 'fat' && this.time >= p.skillReadyAt) {   // 텟카이: 한 번 버티고 40초 뒤 재활성
      p.skillReadyAt = this.time + p.pig.cd;
      p.invulnUntil = this.time + 1.5;
      this.sfx('hit');
      this.float(p.x, p.y, '텟카이!', '#ffe14a');
      return;
    }
    p.lives--;
    if (p.lives > 0) {
      p.invulnUntil = this.time + 2;
      this.sfx('hit');
      this.float(p.x, p.y, '버텼다!', '#9fe0ff');
    } else {
      p.alive = false; p.deadAt = this.time; p.killedBy = by || null;
      this.sfx('die');
      this.hooks.toast?.(`${p.name} (${p.pig.name}) 탈락!`);
    }
  }

  float(x, y, text, color) { this.floats.push({ x, y, text, color, t0: this.time }); this.hooks.float?.(x, y, text, color); }

  // 블록 파편 (화면 효과)
  debris(x, y, color) {
    for (let i = 0; i < 6; i++) {
      this.fx.push({ x: x * 16 + 8, y: y * 16 + 8, vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 50 - 10,
        t0: this.time, life: 0.5, color, size: 2 });
    }
  }
  addFx(e) { this.fx.push({ ...e, t0: this.time }); this.hooks.fx?.(e); }

  // ---------- 스킬 ----------
  skillReady(p) { return this.time >= p.skillReadyAt; }

  useSkill(p) {
    if (p.pig.passive) { if (!p.isBot && !p.remote) this.float(p.x, p.y, '자동으로 발동돼요', '#d0d0e0'); return false; }
    if (!this.skillReady(p)) return false;
    let ok = false;
    if (p.pigId === 'soldier') ok = this.skillThrow(p);
    else if (p.pigId === 'gym') ok = this.skillKick(p);
    else if (p.pigId === 'tech') ok = this.skillBlast(p);
    if (ok) p.skillReadyAt = this.time + p.pig.cd;
    else if (!p.isBot && !p.remote) {
      const why = { soldier: p.activeBombs >= p.maxBombs ? '폭탄이 없어요' : '던질 곳이 없어요',
        gym: '앞에 찰 게 없어요', tech: '범위 안에 폭탄이 없어요' };
      this.float(p.x, p.y, why[p.pigId], '#d0d0e0');
    }
    return ok;
  }

  // 폭탄투척: 앞으로 dist칸(막혔으면 그 다음 빈칸)
  throwTarget(p, dir = p.facing) {
    const [x, y] = this.tileOf(p);
    const [dx, dy] = DIRS[dir];
    return this.landing(x, y, dx, dy, p.pig.dist ?? 3);
  }

  skillThrow(p) {
    if (p.activeBombs >= p.maxBombs) return false;
    const t = this.throwTarget(p);
    if (!t) return false;
    const [x, y] = this.tileOf(p);
    const b = this.newBomb(p, x, y, t[0], t[1]);
    b.dir = DIRS[p.facing];
    b.flying = { fx: x, fy: y, t: 0, dur: 0.3 + 0.03 * (Math.abs(t[0] - x) + Math.abs(t[1] - y)) };
    this.bombs.push(b);
    p.activeBombs++;
    this.sfx('throw');
    return true;
  }

  // 하체운동: 바로 앞 블록을 부수거나, 앞의 폭탄을 kick칸 앞으로 날림
  kickTarget(p, dir = p.facing) {
    const [x, y] = this.tileOf(p);
    const [dx, dy] = DIRS[dir];
    const b = this.bombAt(x + dx, y + dy);
    if (!b) return null;
    const t = this.landing(x + dx, y + dy, dx, dy, p.pig.kick ?? 5);
    return t ? { bomb: b, target: t } : null;
  }

  skillKick(p) {
    const [x, y] = this.tileOf(p);
    const [dx, dy] = DIRS[p.facing];
    const fx = x + dx, fy = y + dy;
    this.addFx({ type: 'punch', x: fx * 16 + 8, y: fy * 16 + 8, life: 0.2 });
    const c = this.cell(fx, fy);
    if (c === HAY || c === CRATE) {
      this.destroyBlock(fx, fy, p, 0.15);
      this.sfx('punch');
      return true;
    }
    const k = this.kickTarget(p);
    if (!k) return false;
    k.bomb.dir = [dx, dy];
    for (const q of this.players) q.passBombs.delete(k.bomb);
    this.fly(k.bomb, k.target, 0.45);
    this.sfx('punch');
    return true;
  }

  // 발파작동: 반경 안의 모든 폭탄(누구 것이든)을 즉시 터뜨림
  inBlastRange(p, b) { return !b.flying && Math.hypot(b.tx - p.x, b.ty - p.y) <= (p.pig.radius ?? 2.5); }

  skillBlast(p) {
    const list = this.bombs.filter(b => this.inBlastRange(p, b));
    if (!list.length) return false;
    this.addFx({ type: 'ring', x: p.x * 16 + 8, y: p.y * 16 + 8, r: (p.pig.radius ?? 2.5) * 16, life: 0.35 });
    for (const b of list) this.explode(b);
    return true;
  }
}
