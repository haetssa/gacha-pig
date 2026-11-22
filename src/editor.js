// 맵 에디터 (본인 전용, 개발 서버에서만 저장 가능). 칸 종류는 data.js의 MAP_CELLS를 그대로 쓴다.
import { MAP_CELLS, PLAYER_COLORS, BASE_STATS } from './data.js';
const RANGE = BASE_STATS.range; // 시작 화력 기준으로 검사/자동배치
import { loadTheme } from './sprites.js';

const $ = s => document.querySelector(s);
const T = 48;
const SPAWN_DIRS = ['1', '2', '3', '4'];
const SPAWN_MIRROR = {
  lr: { 1: '2', 2: '1', 3: '4', 4: '3' },
  ud: { 1: '3', 3: '1', 2: '4', 4: '2' },
  rot: { 1: '4', 4: '1', 2: '3', 3: '2' },
};

const S = {
  id: '', name: '새 맵', theme: 'farm', cols: 11, rows: 13, fill: 0.7, itemChance: 0.4, timeLimit: 150,
  grid: [], brush: '#', dirty: false, th: null,
};
const cv = $('#board'), ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;
const pick = (list, n) => list[Math.abs(n) % list.length];

// ---------- 그리기 ----------
function drawCell(c, ch, x, y, border, px = x * T, py = y * T) {
  const th = S.th;
  c.drawImage(th.floor[0], px, py);
  if (ch === '#') c.drawImage(border ? pick(th.border, x + y) : pick(th.hard, x * 5 + y * 3), px, py);
  else if (ch === 'B') c.drawImage(pick(th.soft, x * 3 + y), px, py);
  else if (ch === '?') {
    c.globalAlpha = 0.55; c.drawImage(pick(th.soft, x * 3 + y), px, py); c.globalAlpha = 1;
    c.font = '28px Jua, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 5; c.strokeStyle = '#2a1a24'; c.strokeText('?', px + 24, py + 26);
    c.fillStyle = '#ffe14a'; c.fillText('?', px + 24, py + 26);
  } else if (ch === 'C') c.drawImage(pick(th.crate, x + y * 7), px, py);
  else if (SPAWN_DIRS.includes(ch)) {
    c.fillStyle = PLAYER_COLORS[Number(ch) - 1]; c.globalAlpha = 0.85;
    c.beginPath(); c.arc(px + 24, py + 24, 17, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
    c.font = '24px Jua, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 4; c.strokeStyle = '#2a1a24'; c.strokeText(ch, px + 24, py + 26);
    c.fillStyle = '#fff'; c.fillText(ch, px + 24, py + 26);
  }
}

function redraw() {
  const { cols, rows } = S;
  cv.width = cols * T; cv.height = rows * T;
  cv.style.width = cols * Math.min(48, Math.floor(640 / cols)) + 'px';
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      drawCell(ctx, S.grid[y][x], x, y, x === 0 || y === 0 || x === cols - 1 || y === rows - 1);
  validate();
}

function buildPalette() {
  const box = $('#palette'); box.innerHTML = '';
  for (const c of MAP_CELLS) {
    const b = document.createElement('button');
    b.className = 'pal' + (S.brush === c.ch ? ' sel' : '');
    b.title = c.hint || c.name;
    const sw = document.createElement('canvas'); sw.width = sw.height = T;
    const sx = sw.getContext('2d'); sx.imageSmoothingEnabled = false;
    drawCell(sx, c.ch, 3, 3, false, 0, 0);
    b.append(sw, c.name);
    b.addEventListener('click', () => { S.brush = c.ch; buildPalette(); });
    box.appendChild(b);
  }
}

// ---------- 칠하기 + 대칭 ----------
function targets(x, y, ch) {
  const mode = document.querySelector('input[name=sym]:checked').value;
  const { cols, rows } = S;
  const out = [[x, y, ch]];
  const mir = (kind, nx, ny) => out.push([nx, ny, SPAWN_DIRS.includes(ch) ? SPAWN_MIRROR[kind][ch] : ch]);
  if (mode === 'lr' || mode === 'both') mir('lr', cols - 1 - x, y);
  if (mode === 'ud' || mode === 'both') mir('ud', x, rows - 1 - y);
  if (mode === 'rot' || mode === 'both') mir('rot', cols - 1 - x, rows - 1 - y);
  return out;
}

function paint(x, y, ch) {
  if (x < 0 || y < 0 || x >= S.cols || y >= S.rows) return;
  for (const [tx, ty, tc] of targets(x, y, ch)) {
    if (SPAWN_DIRS.includes(tc)) // 시작 위치는 각 번호가 맵에 하나만
      for (let yy = 0; yy < S.rows; yy++) for (let xx = 0; xx < S.cols; xx++) if (S.grid[yy][xx] === tc) S.grid[yy][xx] = '.';
    S.grid[ty][tx] = tc;
  }
  markDirty(); redraw();
}

let painting = null;
function cellAt(e) {
  const r = cv.getBoundingClientRect();
  return [Math.floor((e.clientX - r.left) / r.width * S.cols), Math.floor((e.clientY - r.top) / r.height * S.rows)];
}
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  painting = e.button === 2 ? '.' : S.brush;
  const [x, y] = cellAt(e); paint(x, y, painting);
});
cv.addEventListener('pointermove', e => { if (painting !== null) { const [x, y] = cellAt(e); paint(x, y, painting); } });
cv.addEventListener('pointerup', () => { painting = null; });
cv.addEventListener('pointercancel', () => { painting = null; });

// ---------- 빠른 작업 ----------
const blank = (cols, rows, ch = '.') => Array.from({ length: rows }, () => Array(cols).fill(ch));
function fxBorder() {
  for (let x = 0; x < S.cols; x++) { S.grid[0][x] = '#'; S.grid[S.rows - 1][x] = '#'; }
  for (let y = 0; y < S.rows; y++) { S.grid[y][0] = '#'; S.grid[y][S.cols - 1] = '#'; }
}
function fxPillars() { for (let y = 2; y < S.rows - 1; y += 2) for (let x = 2; x < S.cols - 1; x += 2) S.grid[y][x] = '#'; }
function fxSpawns() {
  const c = S.cols - 2, r = S.rows - 2;
  const pts = { 1: [1, 1, 1, 0, 0, 1], 2: [c, 1, -1, 0, 0, 1], 3: [1, r, 1, 0, 0, -1], 4: [c, r, -1, 0, 0, -1] };
  for (const [d, [x, y, ax, ay, bx, by]] of Object.entries(pts)) {
    for (let yy = 0; yy < S.rows; yy++) for (let xx = 0; xx < S.cols; xx++) if (S.grid[yy][xx] === d) S.grid[yy][xx] = '.';
    S.grid[y][x] = d;
    for (let k = 1; k <= RANGE + 1; k++) {   // 자기 폭탄을 피하려면 화력보다 한 칸 더 멀리 갈 수 있어야 함
      const a = [x + ax * k, y + ay * k], b = [x + bx * k, y + by * k];
      if (S.grid[a[1]]?.[a[0]] !== undefined && S.grid[a[1]][a[0]] !== '#') S.grid[a[1]][a[0]] = '.';
      if (S.grid[b[1]]?.[b[0]] !== undefined && S.grid[b[1]][b[0]] !== '#') S.grid[b[1]][b[0]] = '.';
    }
  }
}
function fxFill() {
  const sp = [];
  S.grid.forEach((row, y) => row.forEach((ch, x) => { if (SPAWN_DIRS.includes(ch)) sp.push([x, y]); }));
  for (let y = 1; y < S.rows - 1; y++) for (let x = 1; x < S.cols - 1; x++) {
    if (S.grid[y][x] !== '.') continue;
    if (sp.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) <= RANGE + 1)) continue; // 시작 위치 주변은 비워 둠
    S.grid[y][x] = '?';
  }
}
const fx = (id, fn) => $(id).addEventListener('click', () => { fn(); markDirty(); redraw(); });
fx('#fx-border', fxBorder); fx('#fx-pillars', fxPillars); fx('#fx-fill', fxFill); fx('#fx-spawns', fxSpawns);
fx('#fx-clear', () => { S.grid = blank(S.cols, S.rows); });

// ---------- 검사 ----------
function bfs(sx, sy, passable) {
  const seen = new Set([sx + ',' + sy]), q = [[sx, sy]];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (nx < 0 || ny < 0 || nx >= S.cols || ny >= S.rows || seen.has(k) || !passable(S.grid[ny][nx])) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  return q;
}

function validate() {
  const out = [];
  const add = (lvl, txt) => out.push([lvl, txt]);
  const spawns = {};
  S.grid.forEach((row, y) => row.forEach((ch, x) => { if (SPAWN_DIRS.includes(ch)) spawns[ch] = [x, y]; }));
  const missing = SPAWN_DIRS.filter(d => !spawns[d]);
  if (missing.length) add('bad', `시작 위치 없음: ${missing.join(', ')}번`); else add('ok', '시작 위치 4개 있음');

  let borderOk = true;
  for (let x = 0; x < S.cols; x++) if (S.grid[0][x] !== '#' || S.grid[S.rows - 1][x] !== '#') borderOk = false;
  for (let y = 0; y < S.rows; y++) if (S.grid[y][0] !== '#' || S.grid[y][S.cols - 1] !== '#') borderOk = false;
  add(borderOk ? 'ok' : 'warn', borderOk ? '테두리가 막혀 있음' : '테두리에 구멍이 있음 (밖으로 나갈 수는 없지만 어색해 보임)');

  for (const d of SPAWN_DIRS) {
    if (!spawns[d]) continue;
    const [sx, sy] = spawns[d];
    // 최악의 경우(랜덤 블록 ?가 모두 생김)에도 시작 화력의 자기 폭탄을 피할 칸이 있어야 함
    const reach = bfs(sx, sy, ch => ch === '.' || SPAWN_DIRS.includes(ch));
    const safe = reach.some(([x, y]) => (x !== sx && y !== sy) || Math.max(Math.abs(x - sx), Math.abs(y - sy)) > RANGE);
    add(safe ? 'ok' : 'bad', safe ? `${d}번 탈출 가능` : `${d}번: 자기 폭탄을 피할 빈 공간이 부족함`);
  }

  if (!missing.length) {
    const reach = bfs(spawns['1'][0], spawns['1'][1], ch => ch !== '#');
    const set = new Set(reach.map(([x, y]) => x + ',' + y));
    const conn = SPAWN_DIRS.every(d => set.has(spawns[d].join(',')));
    add(conn ? 'ok' : 'bad', conn ? '모든 시작 위치가 서로 이어짐' : '벽에 막혀 서로 못 만나는 시작 위치가 있음');
  }

  const same = f => S.grid.every((row, y) => row.every((ch, x) => {
    const [mx, my] = f(x, y); const o = S.grid[my][mx];
    const a = SPAWN_DIRS.includes(ch) ? '.' : ch, b = SPAWN_DIRS.includes(o) ? '.' : o;
    return a === b;
  }));
  const sLR = same((x, y) => [S.cols - 1 - x, y]), sRot = same((x, y) => [S.cols - 1 - x, S.rows - 1 - y]);
  add(sLR || sRot ? 'ok' : 'warn', sLR ? '좌우 대칭 (공평)' : sRot ? '180° 대칭 (공평)' : '비대칭: 시작 위치에 따라 유불리가 생김');
  $('#checks').innerHTML = out.map(([l, t]) => `<li class="${l}">${l === 'ok' ? '✔' : l === 'warn' ? '△' : '✖'} ${t}</li>`).join('');

  const cnt = {};
  for (const row of S.grid) for (const ch of row) cnt[ch] = (cnt[ch] || 0) + 1;
  const total = S.cols * S.rows, inner = (S.cols - 2) * (S.rows - 2);
  const softExpect = (cnt.B || 0) + (cnt['?'] || 0) * S.fill;
  $('#counts').innerHTML =
    `전체 ${total}칸 · 안쪽 ${inner}칸<br>단단한 ${cnt['#'] || 0} · 부서지는 ${cnt.B || 0} · 랜덤 ${cnt['?'] || 0} · 특수상자 ${cnt.C || 0}<br>` +
    `예상 아이템 ≈ ${((cnt.C || 0) + softExpect * S.itemChance).toFixed(1)}개 (특수상자 ${cnt.C || 0} 포함)`;
}

// ---------- 설정 폼 ----------
const bind = (sel, key, num = false) => $(sel).addEventListener('input', e => {
  S[key] = num ? Number(e.target.value) : e.target.value; markDirty(); syncForm(); validate();
});
bind('#f-id', 'id'); bind('#f-name', 'name'); bind('#f-fill', 'fill', true); bind('#f-item', 'itemChance', true); bind('#f-time', 'timeLimit', true);
$('#f-theme').addEventListener('change', async e => { S.theme = e.target.value; await applyTheme(); markDirty(); });

function syncForm() {
  $('#f-id').value = S.id; $('#f-name').value = S.name; $('#f-theme').value = S.theme;
  $('#f-cols').value = S.cols; $('#f-rows').value = S.rows;
  $('#f-fill').value = S.fill; $('#v-fill').textContent = Math.round(S.fill * 100) + '%';
  $('#f-item').value = S.itemChance; $('#v-item').textContent = Math.round(S.itemChance * 100) + '%';
  $('#f-time').value = S.timeLimit;
}
$('#btn-resize').addEventListener('click', () => {
  const cols = Math.min(19, Math.max(5, Number($('#f-cols').value) || S.cols));
  const rows = Math.min(21, Math.max(5, Number($('#f-rows').value) || S.rows));
  const g = blank(cols, rows);
  for (let y = 0; y < Math.min(rows, S.rows); y++) for (let x = 0; x < Math.min(cols, S.cols); x++) g[y][x] = S.grid[y][x];
  S.cols = cols; S.rows = rows; S.grid = g; markDirty(); syncForm(); redraw();
});

async function applyTheme() { S.th = await loadTheme(S.theme); buildPalette(); redraw(); }

function markDirty() { S.dirty = true; setStatus('저장 안 됨'); }
function setStatus(t, bad) { const s = $('#status'); s.textContent = t; s.style.color = bad ? '#ff6a6a' : ''; }

// ---------- 파일 ----------
const api = (p, opt) => fetch('/__api' + p, opt).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; });

async function refreshList(select) {
  const names = await api('/maps');
  const sel = $('#map-list'); sel.innerHTML = names.map(n => `<option>${n}</option>`).join('');
  if (select) sel.value = select;
}

function toFile() {
  return { name: S.name, theme: S.theme, cols: S.cols, rows: S.rows, fill: S.fill, itemChance: S.itemChance,
    timeLimit: S.timeLimit, grid: S.grid.map(r => r.join('')) };
}
function fromFile(id, m) {
  S.id = id; S.name = m.name || id; S.theme = m.theme || 'farm'; S.cols = m.cols; S.rows = m.rows;
  S.fill = m.fill ?? 0.7; S.itemChance = m.itemChance ?? 0.4; S.timeLimit = m.timeLimit ?? 150;
  S.grid = m.grid.map(r => r.split(''));
  S.dirty = false;
}

async function save() {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(S.id)) { setStatus('파일 이름을 영문/숫자/_ 로 적어주세요', true); return false; }
  try {
    await api('/map?name=' + S.id, { method: 'POST', body: JSON.stringify(toFile()) });
    S.dirty = false; setStatus('저장됨 · src/maps/' + S.id + '.json'); await refreshList(S.id); return true;
  } catch (e) { setStatus('저장 실패: ' + e.message, true); return false; }
}
$('#btn-save').addEventListener('click', save);
$('#btn-test').addEventListener('click', async () => { if (await save()) window.open('/?map=' + S.id, '_blank'); });
$('#btn-load').addEventListener('click', async () => {
  if (S.dirty && !confirm('저장하지 않은 변경이 사라져요. 불러올까요?')) return;
  const id = $('#map-list').value;
  try { fromFile(id, await api('/map?name=' + id)); syncForm(); await applyTheme(); setStatus('불러옴: ' + id); }
  catch (e) { setStatus('불러오기 실패: ' + e.message, true); }
});
$('#btn-new').addEventListener('click', async () => {
  if (S.dirty && !confirm('저장하지 않은 변경이 사라져요. 새 맵을 만들까요?')) return;
  Object.assign(S, { id: '', name: '새 맵', cols: 11, rows: 13, fill: 0.7, itemChance: 0.4, timeLimit: 150 });
  S.grid = blank(S.cols, S.rows); fxBorder(); fxPillars(); fxSpawns(); fxFill();
  syncForm(); await applyTheme(); setStatus('새 맵 (파일 이름을 적고 저장하세요)'); S.dirty = false;
});

// ---------- 시작 ----------
(async () => {
  try {
    const themes = await api('/themes');
    $('#f-theme').innerHTML = themes.map(t => `<option>${t}</option>`).join('');
    await refreshList();
    const first = new URLSearchParams(location.search).get('map') || (await api('/maps')).find(n => n === 'farm_11x13') || $('#map-list').value;
    $('#map-list').value = first;
    fromFile(first, await api('/map?name=' + first));
    syncForm(); await applyTheme(); setStatus('불러옴: ' + first);
  } catch (e) {
    setStatus('개발 서버(실행.bat)에서 이 컴퓨터로 열어야 해요: ' + e.message, true);
  }
})();
