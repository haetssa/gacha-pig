// 봇 AI: 칸 중심에서만 판단하고, 판단 사이에는 다음 칸 중심(target)으로 걸어간다.
// 판단 순서: 위험하면 도망 -> 스킬 -> 폭탄 설치(탈출로 확인) -> 목표(아이템/블록/적)로 이동
import { DIRS, CELL } from './game.js';

const DIR_LIST = ['up', 'down', 'left', 'right'];
const C_EPS = 1e-3;

function shuffled(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

export function blastTiles(g, x, y, range, pierce) {
  const out = [[x, y]];
  for (const [dx, dy] of Object.values(DIRS)) {
    for (let r = 1; r <= range; r++) {
      const cx = x + dx * r, cy = y + dy * r;
      const c = g.cell(cx, cy);
      if (c === CELL.WALL) break;
      out.push([cx, cy]);
      if ((c === CELL.HAY || c === CELL.CRATE) && !pierce) break;
    }
  }
  return out;
}

// 각 칸이 몇 초 뒤 불바다가 되는지 (Infinity = 안전)
function dangerMap(g, extra) {
  const D = Array.from({ length: g.rows }, () => Array(g.cols).fill(Infinity));
  for (const k of g.flames.keys()) { const [x, y] = k.split(',').map(Number); D[y][x] = 0; }
  const bombs = g.bombs.map(b => ({ x: b.tx, y: b.ty, range: b.range, pierce: b.pierce,
    t: b.flying ? b.timer + (b.flying.dur - b.flying.t) : b.timer }));
  if (extra) bombs.push(extra);
  for (const b of bombs) b.tiles = blastTiles(g, b.x, b.y, b.range, b.pierce);
  for (let it = 0; it < 3; it++) {
    for (const a of bombs) for (const b of bombs) {
      if (a !== b && b.t > a.t && a.tiles.some(([x, y]) => x === b.x && y === b.y)) b.t = a.t;
    }
  }
  for (const b of bombs) for (const [x, y] of b.tiles) if (b.t < D[y][x]) D[y][x] = b.t;
  return D;
}

function bfs(g, p, D, sx, sy, goal, maxDepth) {
  const speed = g.speedOf(p);
  const seen = new Set([sx + ',' + sy]);
  const q = [[sx, sy, 0, null]];
  for (let qi = 0; qi < q.length; qi++) {
    const [x, y, d, first] = q[qi];
    if (d > 0 && goal(x, y, d)) return { x, y, d, first };
    if (d >= maxDepth) continue;
    for (const dir of shuffled(DIR_LIST)) {
      const [dx, dy] = DIRS[dir];
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (seen.has(k)) continue;
      if (g.cell(nx, ny) !== CELL.EMPTY || g.bombAt(nx, ny)) continue;
      const arrive = (d + 1) / speed;
      const t = D[ny][nx];
      if (t !== Infinity && arrive > t - 0.35 && arrive < t + 0.75) continue; // 지나갈 때 불바다
      seen.add(k);
      q.push([nx, ny, d + 1, first || dir]);
    }
  }
  return null;
}

function adjacentBlock(g, x, y) {
  return Object.values(DIRS).some(([dx, dy]) => { const c = g.cell(x + dx, y + dy); return c === CELL.HAY || c === CELL.CRATE; });
}

const hitsAny = (tiles, pts) => pts.some(([ex, ey]) => tiles.some(([x, y]) => x === ex && y === ey));

function trySkill(g, p, enemyTiles) {
  if (p.pig.passive || Math.random() < 0.3) return null; // 너무 완벽하지 않게
  const [x, y] = g.tileOf(p);
  const me = [[x, y]];
  if (p.pigId === 'tech') {
    for (const b of g.bombs) {
      if (!g.inBlastRange(p, b)) continue;
      const tiles = blastTiles(g, b.tx, b.ty, b.range, b.pierce);
      if (hitsAny(tiles, enemyTiles) && !hitsAny(tiles, me)) return {};
    }
    return null;
  }
  if (p.pigId === 'soldier') {
    if (p.activeBombs >= p.maxBombs) return null;
    for (const dir of shuffled(DIR_LIST)) {
      const t = g.throwTarget(p, dir);
      if (!t) continue;
      const tiles = blastTiles(g, t[0], t[1], p.range, p.pierce);
      if (hitsAny(tiles, enemyTiles) && !hitsAny(tiles, me)) return { face: dir };
    }
    return null;
  }
  if (p.pigId === 'gym') {
    for (const dir of shuffled(DIR_LIST)) {
      const k = g.kickTarget(p, dir);
      if (k) {
        const tiles = blastTiles(g, k.target[0], k.target[1], k.bomb.range, k.bomb.pierce);
        if (hitsAny(tiles, enemyTiles) && !hitsAny(tiles, me)) return { face: dir };
      }
      const [dx, dy] = DIRS[dir];
      const c = g.cell(x + dx, y + dy);
      if ((c === CELL.HAY || c === CELL.CRATE) && Math.random() < 0.5) return { face: dir };
    }
  }
  return null;
}

function steer(p, t, out) {
  const dx = t[0] - p.x, dy = t[1] - p.y;
  out.dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  out.goal = t;
  return out;
}

export function botInput(g, p, dt = 1 / 60) {
  const ai = p.ai;
  const out = { dir: null, bomb: false, skill: false, goal: null };
  const cx = Math.round(p.x), cy = Math.round(p.y);
  const centered = Math.abs(p.x - cx) < C_EPS && Math.abs(p.y - cy) < C_EPS;

  // 다음 칸 중심으로 가는 중
  if (ai.target) {
    const [tx, ty] = ai.target;
    if (Math.abs(p.x - tx) < C_EPS && Math.abs(p.y - ty) < C_EPS) ai.target = null;
    else {
      const prog = Math.abs(p.x - (ai.lx ?? p.x)) + Math.abs(p.y - (ai.ly ?? p.y));
      ai.lx = p.x; ai.ly = p.y;
      ai.stuck = prog < 1e-4 ? (ai.stuck || 0) + dt : 0;
      if (ai.stuck > 0.3) { ai.stuck = 0; ai.target = null; }   // 길이 막혔으면 다시 판단
      else return steer(p, ai.target, out);
    }
  }
  if (!centered) { ai.target = [cx, cy]; ai.lx = p.x; ai.ly = p.y; return steer(p, ai.target, out); }

  const go = dir => {
    if (!dir) return out;
    const [dx, dy] = DIRS[dir];
    ai.target = [cx + dx, cy + dy]; ai.lx = p.x; ai.ly = p.y; ai.stuck = 0;
    out.dir = dir; out.goal = ai.target;
    return out;
  };

  const x = cx, y = cy;
  const D = dangerMap(g);
  const speed = g.speedOf(p);
  const enemies = g.players.filter(e => e.alive && e !== p);
  const enemyTiles = enemies.map(e => g.tileOf(e));

  // 1) 위험하면 도망
  if (D[y][x] !== Infinity) {
    const r = bfs(g, p, D, x, y, (ax, ay) => D[ay][ax] === Infinity, 20);
    return go(r ? r.first : null);
  }

  // 2) 스킬
  if (g.skillReady(p)) {
    const s = trySkill(g, p, enemyTiles);
    if (s) { if (s.face) p.facing = s.face; out.skill = true; return out; }
  }

  // 3) 폭탄 설치
  if (p.activeBombs < p.maxBombs && !g.bombAt(x, y)) {
    const tiles = blastTiles(g, x, y, p.range, p.pierce);
    const hitsBlock = tiles.some(([ax, ay]) => { const c = g.cell(ax, ay); return c === CELL.HAY || c === CELL.CRATE; });
    if ((hitsBlock && Math.random() < 0.85) || hitsAny(tiles, enemyTiles)) {
      const D2 = dangerMap(g, { x, y, t: p.fuse, range: p.range, pierce: p.pierce });
      const esc = bfs(g, p, D2, x, y, (ax, ay) => D2[ay][ax] === Infinity, 12);
      if (esc && esc.d / speed < p.fuse - 0.5) { out.bomb = true; return go(esc.first); }
    }
  }

  // 4) 목표로 이동
  const safe = (ax, ay) => D[ay][ax] === Infinity;
  const near = (ax, ay, n) => enemyTiles.some(([ex, ey]) => Math.abs(ex - ax) + Math.abs(ey - ay) <= n);
  const r =
    bfs(g, p, D, x, y, (ax, ay) => g.items.has(ax + ',' + ay), 8) ||
    (Math.random() < 0.35 ? bfs(g, p, D, x, y, (ax, ay) => safe(ax, ay) && near(ax, ay, 2), 25) : null) ||
    bfs(g, p, D, x, y, (ax, ay) => safe(ax, ay) && adjacentBlock(g, ax, ay), 25) ||
    bfs(g, p, D, x, y, (ax, ay) => safe(ax, ay) && near(ax, ay, 2), 30) ||
    bfs(g, p, D, x, y, (ax, ay) => safe(ax, ay), 3);
  return go(r ? r.first : null);
}
