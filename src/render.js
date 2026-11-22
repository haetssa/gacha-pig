// 게임 화면 그리기 (캔버스). 한 칸 = 48px.
// 타일/아이템/폭탄/돼지는 48px 그림 그대로, 불꽃과 파편은 16 단위 좌표를 K배 확대해서 그린다.
import { CELL, FLAME_TIME } from './game.js';
import { drawPig } from './sprites.js';
import { ITEMS, RARITY } from './data.js';

export const TILE = 48;
const K = TILE / 16;
const WALK = [0, 1, 0, 2]; // 걷기 프레임 순서
const PIG_SCALE = 1.3;     // 돼지 그림 확대 배율 (칸 48px 기준)

const pick = (list, n) => list[n % list.length];

export function render(ctx, g, A, me) {
  const th = A.theme, cm = A.common;
  const W = g.cols * TILE, H = g.rows * TILE;

  ctx.save();
  if (g.shake > 0) ctx.translate(Math.round((Math.random() - 0.5) * 6), Math.round((Math.random() - 0.5) * 6));
  ctx.fillStyle = '#2a2140';
  ctx.fillRect(-12, -12, W + 24, H + 24);

  // ---------- 바닥 + 블록 ----------
  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) {
      const v = g.floorVar[y][x];
      // 바닥: 첫 장이 기본, 나머지 변형은 가끔 (장식 꽃, 얼룩 등)
      const fl = th.floor;
      ctx.drawImage(v < 0.2 && fl.length > 1 ? fl[1 + Math.floor(v / 0.2 * (fl.length - 1))] : fl[0], x * TILE, y * TILE);
      const c = g.grid[y][x];
      if (c === CELL.WALL) {
        const border = x === 0 || y === 0 || x === g.cols - 1 || y === g.rows - 1;
        ctx.drawImage(border ? pick(th.border, x + y) : pick(th.hard, x * 5 + y * 3), x * TILE, y * TILE);
      } else if (c === CELL.HAY) ctx.drawImage(pick(th.soft, x * 3 + y), x * TILE, y * TILE);
      else if (c === CELL.CRATE) ctx.drawImage(pick(th.crate, x + y * 7), x * TILE, y * TILE);
    }
  }

  // ---------- 아이템 (종류별 색 원 + 둥둥) ----------
  for (const [k, t] of g.items) {
    const [x, y] = k.split(',').map(Number);
    const bob = Math.round(Math.sin(g.time * 5 + x) * 3);
    ctx.fillStyle = ITEMS[t].color;
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.ellipse(x * TILE + 24, y * TILE + 40, 17, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.drawImage(cm[ITEMS[t].icon], x * TILE, y * TILE - 4 + bob);
  }

  // ---------- 폭탄 ----------
  for (const b of g.bombs) {
    const cx = b.x * TILE + 24, cy = b.y * TILE + 24;
    const fast = !b.flying && b.timer < 0.8;
    const pulse = b.flying ? 1 : 1 + 0.1 * Math.sin((g.time - b.t0) * (fast ? 28 : 9));
    ctx.fillStyle = b.owner.color;
    ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.ellipse(cx, cy + 15, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const s = TILE * pulse;
    ctx.drawImage(cm.bomb, Math.round(cx - s / 2), Math.round(cy - s / 2 - (b.z || 0) * K), Math.round(s), Math.round(s));
  }

  // ---------- 기술자돼지(내가 기술자일 때만): 발파 범위와 범위 안 폭탄 위 번개 ----------
  if (me && me.alive && me.pigId === 'tech' && g.time > 0) {
    const ready = g.skillReady(me);
    const R = (me.pig.radius ?? 2.5) * TILE;
    ctx.save();
    ctx.globalAlpha = ready ? 0.5 : 0.18;
    ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.arc(me.x * TILE + 24, me.y * TILE + 24, R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    for (const b of g.bombs) {
      if (!g.inBlastRange(me, b)) continue;
      const bx = b.x * TILE + 24, by = b.y * TILE - 8 + Math.round(Math.sin(g.time * 8) * 2);
      ctx.globalAlpha = ready ? 1 : 0.4;
      drawBolt(ctx, bx, by);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- 불꽃 (그림 3프레임: 크게 -> 사그라듦) ----------
  for (const [k, f] of g.flames) {
    const [x, y] = k.split(',').map(Number);
    const life = Math.max(0, (f.until - g.time) / FLAME_TIME);
    const frame = life > 0.62 ? 0 : life > 0.3 ? 1 : 2;
    const fl = A.flame;
    let img;
    if (f.kind === 'c') img = fl.center[frame];
    else if (f.end && f.dir) {
      const d = f.dir[0] > 0 ? 'right' : f.dir[0] < 0 ? 'left' : f.dir[1] > 0 ? 'down' : 'up';
      img = fl.end[frame][d];
    } else img = fl.mid[frame][f.kind];
    ctx.drawImage(img, x * TILE, y * TILE);
  }

  // ---------- 파편 (16 단위 x K) ----------
  ctx.save();
  ctx.scale(K, K);
  g.fx = g.fx.filter(e => g.time - e.t0 < e.life);
  for (const e of g.fx) {
    const a = g.time - e.t0;
    if (e.type === 'ring') {   // 발파작동: 범위가 번쩍
      ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 2; ctx.globalAlpha = 1 - a / e.life;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.6 + 0.4 * a / e.life), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }
    if (e.type === 'punch') {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.globalAlpha = 1 - a / e.life;
      ctx.beginPath(); ctx.arc(e.x, e.y, 3 + a * 40, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }
    ctx.fillStyle = e.color;
    ctx.fillRect(Math.round(e.x + e.vx * a), Math.round(e.y + e.vy * a + 120 * a * a), e.size, e.size);
  }
  ctx.restore();

  // ---------- 돼지들 (y순 정렬) ----------
  const order = [...g.players].sort((a, b) => a.y - b.y);
  const SZ = Math.round(TILE * PIG_SCALE);
  const headOf = p => Math.round(p.y * TILE) + 44 - SZ + 2;   // 돼지 머리 위 y
  for (const p of order) {
    const deadFor = p.alive ? 0 : g.time - p.deadAt;
    if (!p.alive && deadFor > 0.8) continue;
    const px = Math.round(p.x * TILE), py = Math.round(p.y * TILE);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.alive ? 0.9 : 0.4;
    ctx.beginPath(); ctx.ellipse(px + 24, py + 42, 17 * PIG_SCALE * 0.85, 6 * PIG_SCALE * 0.85, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const invuln = p.alive && g.time < p.invulnUntil;
    if (invuln && Math.floor(g.time * 14) % 2) continue;

    const walking = p.alive && p.moving;
    const frame = walking ? WALK[Math.floor(p.bob / 1.6) % 4] : 0;
    const hop = walking && frame !== 0 ? -2 : 0;
    const sx = px + 24 - SZ / 2, sy = py + 44 - SZ + hop;
    if (!p.alive) {
      ctx.globalAlpha = Math.max(0, 1 - deadFor / 0.8);
      drawPig(ctx, A.pigs[p.pigId], p.facing, 0, sx, sy - Math.round(deadFor * 60), SZ);
      ctx.globalAlpha = 1;
      continue;
    }
    drawPig(ctx, A.pigs[p.pigId], p.facing, frame, sx, sy, SZ);
    const top = sy + 2;

    if (g.time < p.stunUntil) {
      ctx.fillStyle = '#ffe14a';
      for (let i = 0; i < 3; i++) {
        const ang = g.time * 6 + i * 2.1;
        ctx.fillRect(Math.round(px + 24 + Math.cos(ang) * 16) - 2, Math.round(top - 2 + Math.sin(ang) * 5), 4, 4);
      }
    }
    if (p === me) { // 내 돼지 표시
      ctx.fillStyle = p.color;
      const ty = top - 14 + Math.round(Math.sin(g.time * 6) * 2);
      ctx.beginPath(); ctx.moveTo(px + 15, ty); ctx.lineTo(px + 33, ty); ctx.lineTo(px + 24, ty + 9); ctx.fill();
    }
  }

  // ---------- 시작 연출: 가챠로 얻은 특성을 머리 위에 잠깐 표시 ----------
  if (g.reveal && (g.ready > 0 || g.time < 1.2)) {
    const a = g.ready > 0 ? 1 : Math.max(0, 1 - g.time / 1.2);
    ctx.font = '19px Jua, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of g.players) {
      if (!p.alive || !p.perk) continue;
      const col = RARITY[p.perk.rarity].color;
      const w = ctx.measureText(p.perk.name).width + 22;
      const cx = Math.min(W - w / 2 - 4, Math.max(w / 2 + 4, Math.round(p.x * TILE) + 24));
      const cy = Math.max(18, headOf(p) - 30);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(20,16,30,0.9)';
      ctx.beginPath(); ctx.roundRect(cx - w / 2, cy - 15, w, 30, 15); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.stroke();
      ctx.fillStyle = col; ctx.fillText(p.perk.name, cx, cy + 1);
    }
    if (g.ready > 0) {
      ctx.font = '72px Jua, sans-serif';
      const txt = g.ready > 0.9 ? '준비!' : '시작!';
      ctx.lineWidth = 9; ctx.strokeStyle = '#2a1a24'; ctx.strokeText(txt, W / 2, H * 0.5);
      ctx.fillStyle = '#ffd83a'; ctx.fillText(txt, W / 2, H * 0.5);
    }
    ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
  }

  // 떠오르는 글자
  g.floats = g.floats.filter(f => g.time - f.t0 < 0.9);
  ctx.font = '20px Jua, sans-serif';
  ctx.textAlign = 'center';
  for (const f of g.floats) {
    const a = g.time - f.t0;
    ctx.globalAlpha = 1 - a / 0.9;
    const tx = f.x * TILE + 24, ty = f.y * TILE - 14 - a * 40;
    ctx.lineWidth = 5; ctx.strokeStyle = '#2a1a24'; ctx.strokeText(f.text, tx, ty);
    ctx.fillStyle = f.color; ctx.fillText(f.text, tx, ty);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// 번개 아이콘 (기술자돼지 발파 범위 표시)
function drawBolt(ctx, x, y) {
  const pts = [[2, -14], [-8, 2], [-1, 2], [-4, 14], [8, -3], [1, -3], [5, -14]];
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py)));
  ctx.closePath();
  ctx.lineWidth = 4; ctx.strokeStyle = '#2a1a24'; ctx.stroke();
  ctx.fillStyle = '#ffe14a'; ctx.fill();
}
