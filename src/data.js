// 게임 밸런스/내용 데이터. 수치 조정은 여기서만 하면 된다.

// 기본 능력치는 모든 돼지가 같다. 돼지의 차이는 "고유 스킬 1개"뿐이고,
// 속도/폭탄/화력은 아이템으로 키운다.
export const BASE_STATS = { speed: 3.3, bombs: 1, range: 2, lives: 1 };

export const PIGS = {
  soldier: {
    id: 'soldier', name: '군인돼지', skill: '폭탄투척', cd: 5, dist: 3,
    desc: '폭탄을 앞으로 3칸 던져서 설치. 그 칸이 막혀 있으면 그 다음 빈칸에 떨어짐',
    ...BASE_STATS,
  },
  gym: {
    id: 'gym', name: '헬창돼지', skill: '하체운동', cd: 5, kick: 5,
    desc: '바로 앞의 블록을 걷어차 부수거나, 폭탄을 걷어차 5칸 앞으로 날림',
    ...BASE_STATS,
  },
  fat: {
    id: 'fat', name: '뚱돼지', skill: '텟카이', cd: 40, passive: true,
    desc: '폭탄에 한 번 맞아도 버팀(자동). 버틴 뒤 40초가 지나야 다시 버틸 수 있음',
    ...BASE_STATS,
  },
  tech: {
    id: 'tech', name: '기술자돼지', skill: '발파작동', cd: 10, radius: 2.5,
    desc: '내 주변 반경 안의 폭탄을 누르는 즉시 전부 터뜨림. 범위 안 폭탄에는 번개 표시가 보임(나에게만)',
    ...BASE_STATS,
  },
};
export const PIG_ORDER = ['soldier', 'gym', 'fat', 'tech'];

// 가챠 등급. w = 뽑힐 가중치(상대값). 특성이 없는 등급은 자동으로 건너뛴다.
export const RARITY = {
  common: { name: '일반', w: 55, color: '#c3cad6' },
  rare:   { name: '희귀', w: 28, color: '#4aa8ff' },
  epic:   { name: '영웅', w: 13, color: '#c07bff' },
  legend: { name: '전설', w: 4,  color: '#ffb020' },
};

// 맵 에디터가 쓰는 칸 종류. 맵 json의 grid 문자와 같다. 새 블록/기믹을 만들면 여기에 한 줄 추가
// (게임 규칙은 game.js의 Game 생성자에서 이 문자를 해석)
export const MAP_CELLS = [
  { ch: '.', name: '빈 칸',        role: 'floor' },
  { ch: '#', name: '단단한 블록',  role: 'hard' },
  { ch: 'B', name: '부서지는 블록', role: 'soft' },
  { ch: '?', name: '랜덤 블록',    role: 'random', hint: '판마다 있을 수도 없을 수도 있음(맵 설정의 채움 비율)' },
  { ch: 'C', name: '특수 상자',    role: 'crate', hint: '아이템이 반드시 나옴' },
  { ch: '1', name: '시작 1', role: 'spawn' }, { ch: '2', name: '시작 2', role: 'spawn' },
  { ch: '3', name: '시작 3', role: 'spawn' }, { ch: '4', name: '시작 4', role: 'spawn' },
];

// ※ 아래 목록은 임시. 상세 가챠 목록이 정해지면 여기만 교체/추가한다.
//   새 특성 = { id, rarity, name, desc, apply: p => {...} } 한 줄 추가 (규칙을 바꾸는 효과는 game.js에 훅 추가 필요)
export const PERKS = [
  { id: 'fire',   rarity: 'common', name: '화력 +1',     desc: '폭발 범위 +1',            apply: p => { p.range += 1; } },
  { id: 'bomb',   rarity: 'common', name: '폭탄 +1',     desc: '동시에 놓는 폭탄 +1',      apply: p => { p.maxBombs += 1; } },
  { id: 'shoe',   rarity: 'common', name: '날쌘 발굽',   desc: '이동 속도 증가',           apply: p => { p.speedLv += 1; } },
  { id: 'shield', rarity: 'rare',   name: '보호막',      desc: '한 번 맞아도 버팀',        apply: p => { p.lives += 1; } },
  { id: 'fuse',   rarity: 'rare',   name: '짧은 도화선', desc: '폭탄이 더 빨리 터짐',      apply: p => { p.fuse = 1.6; } },
  { id: 'luck',   rarity: 'rare',   name: '행운',        desc: '블록에서 아이템이 잘 나옴', apply: p => { p.luck = true; } },
  { id: 'pierce', rarity: 'legend', name: '관통 폭발',   desc: '폭발이 블록을 뚫고 지나감', apply: p => { p.pierce = true; } },
  { id: 'rage',   rarity: 'legend', name: '폭주',        desc: '화력+2 폭탄+1, 대신 느려짐', apply: p => { p.range += 2; p.maxBombs += 1; p.speedLv -= 1; } },
];

export function rollPerk() {
  const tiers = Object.entries(RARITY).filter(([k]) => PERKS.some(p => p.rarity === k));
  const total = tiers.reduce((s, [, v]) => s + v.w, 0);
  let r = Math.random() * total, rar = tiers[0][0];
  for (const [k, v] of tiers) { if ((r -= v.w) < 0) { rar = k; break; } }
  const pool = PERKS.filter(p => p.rarity === rar);
  return pool[Math.floor(Math.random() * pool.length)];
}

// 블록에서 나오는 아이템 (Tiny Farm 채소 타일)
export const ITEMS = {
  // icon = public/assets/common/<icon>.png, color = 바닥에 깔리는 종류 표시 색, apply가 false면 이미 최대
  bomb:  { name: '폭탄 +1', icon: 'item_bomb',  color: '#4aa8ff', desc: '동시에 놓을 수 있는 폭탄이 1개 늘어남', maxText: '폭탄 8개까지',
           apply: p => (p.maxBombs < 8 ? (p.maxBombs++, p.items.bomb++, true) : false) },
  fire:  { name: '화력 +1', icon: 'item_fire',  color: '#ff4a3a', desc: '폭발이 1칸 더 멀리 퍼짐', maxText: '화력 10칸까지',
           apply: p => (p.range < 10 ? (p.range++, p.items.fire++, true) : false) },
  speed: { name: '속도 +1', icon: 'item_speed', color: '#ffd83a', desc: '이동 속도가 빨라짐', maxText: '4개까지',
           apply: p => (p.items.speed < SPEED_ITEM_MAX ? (p.speedLv++, p.items.speed++, true) : false) },
};
export const SPEED_ITEM_MAX = 4;

export const PLAYER_COLORS = ['#ff5a5a', '#4aa8ff', '#5ad65a', '#ffc94a'];
export const BOT_NAMES = ['봇1', '봇2', '봇3'];
