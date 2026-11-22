// 이미지 불러오기. 돼지는 tools/make_pigs.py가 만든 시트(public/assets/pigs/<id>.png)를 쓴다.
// 시트: 3x3, 칸 48x48. 행 = 아래/위/옆(오른쪽), 열 = 서있기/걸음A/걸음B. 왼쪽은 옆면을 반전해서 그린다.

export const PIG_CELL = 48;

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('이미지 로드 실패: ' + src));
    img.src = src;
  });
}

// 모든 테마가 같이 쓰는 그림 (폭탄, 아이템). tools/make_tiles.py 가 만든다
const COMMON = ['bomb', 'item_bomb', 'item_fire', 'item_speed'];
export async function loadCommon() {
  const imgs = await Promise.all(COMMON.map(n => loadImage(`assets/common/${n}.png`)));
  return Object.fromEntries(COMMON.map((n, i) => [n, imgs[i]]));
}

// 폭발 조각. 시트(3x3, 칸 48): 행 = 가운데/중간 줄기/끝부분, 열 = 프레임 3개.
// 줄기와 끝부분은 가로 그림 하나만 있고, 필요한 방향은 여기서 돌려서 미리 만들어 둔다.
export async function loadFlames() {
  const img = await loadImage('assets/effects/flames.png');
  const N = PIG_CELL;
  const make = (row, col, rot, mirror) => {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    x.translate(N / 2, N / 2); x.rotate(rot * Math.PI / 2); if (mirror) x.scale(-1, 1);
    x.drawImage(img, col * N, row * N, N, N, -N / 2, -N / 2, N, N);
    return c;
  };
  const out = { center: [], mid: [], end: [] };
  for (let f = 0; f < 3; f++) {
    out.center.push(make(0, f, 0, false));
    out.mid.push({ h: make(1, f, 0, false), v: make(1, f, 1, false) });
    out.end.push({ right: make(2, f, 0, false), left: make(2, f, 0, true), down: make(2, f, 1, false), up: make(2, f, 3, false) });
  }
  return out;
}

// 맵 분위기(테마) 하나: floor/hard/soft/crate/border 역할마다 그림이 여러 장일 수 있음
export async function loadTheme(name) {
  const base = `assets/themes/${name}/`;
  const manifest = await (await fetch(base + 'theme.json')).json();
  const out = {};
  for (const [role, files] of Object.entries(manifest)) {
    out[role] = await Promise.all(files.map(f => loadImage(base + f)));
  }
  return out;
}

export async function buildPigSprites(ids) {
  const imgs = await Promise.all(ids.map(id => loadImage(`assets/pigs/${id}.png`)));
  return Object.fromEntries(ids.map((id, i) => [id, imgs[i]]));
}

// 선택/가챠 화면에서 <img src>로 쓰는 정면 아이콘
export function pigDataURL(pigId) {
  return `assets/pigs/${pigId}_icon.png`;
}

// 방향/걸음 프레임을 그린다. (x,y)는 48x48 칸의 왼쪽 위
export function drawPig(ctx, atlas, facing, frame, x, y, size = PIG_CELL) {
  const row = facing === 'down' ? 0 : facing === 'up' ? 1 : 2;
  const sx = frame * PIG_CELL, sy = row * PIG_CELL;
  if (facing === 'left') {
    ctx.save();
    ctx.translate(x + size, y);
    ctx.scale(-1, 1);
    ctx.drawImage(atlas, sx, sy, PIG_CELL, PIG_CELL, 0, 0, size, size);
    ctx.restore();
  } else {
    ctx.drawImage(atlas, sx, sy, PIG_CELL, PIG_CELL, x, y, size, size);
  }
}

