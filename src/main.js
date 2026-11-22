// 화면 흐름
//   혼자 하기: 타이틀 → 돼지 선택 → (인게임 + 가챠) → 대결 → 결과
//   온라인:   타이틀 → 닉네임 → 로비(방 목록) → 방(돼지 선택/준비) → (인게임 + 가챠) → 대결 → 결과 → 5초 뒤 방
import { PIGS, PIG_ORDER, PERKS, RARITY, ITEMS, SPEED_ITEM_MAX, PLAYER_COLORS, BOT_NAMES, rollPerk } from './data.js';
import { Game } from './game.js';
import { render, TILE } from './render.js';
import { botInput } from './ai.js';
import { Input } from './input.js';
import { sfx, unlockAudio, playMusic, stopMusic, toggleMusic, isMusicOn } from './audio.js';
import { loadCommon, loadTheme, loadFlames, buildPigSprites, pigDataURL } from './sprites.js';
import { Online, VERSION } from './net/online.js';
import { HostSession, ClientSession } from './net/session.js';
import { FIREBASE_CONFIG, ONLINE } from './net/config.js';

// 맵 파일은 src/maps/*.json 전부 자동 등록. 개발 중 주소 뒤에 ?map=파일이름 으로 골라서 볼 수 있음 (예: ?map=farm_9x11)
const MAPS = import.meta.glob('./maps/*.json', { eager: true, import: 'default' });
const MAP_IDS = Object.keys(MAPS).map(k => k.slice(7, -5)).filter(id => !id.startsWith('_'));
const getMap = id => MAPS[`./maps/${id}.json`];
const DEFAULT_MAP = 'farm_11x13';
function pickMap() { return getMap(new URLSearchParams(location.search).get('map')) ?? getMap(DEFAULT_MAP); }

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const state = { myPig: null, game: null, assets: null, mode: 'solo', meIdx: 0, session: null };
const net = { online: null, nick: '', pig: 'soldier', meta: null, players: {}, startSeq: null, backTimer: null, lobbyOn: false };
const input = new Input();
const cv = $('#cv');
const ctx = cv.getContext('2d');
const world = document.createElement('canvas'); // 48px 칸 그대로 그리는 작업용 캔버스
const wctx = world.getContext('2d');
let view = { scale: 1 };

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  if (id !== 'scr-game') playMusic('lobby');
}

// ---------- 배경음악 켜기/끄기 ----------
function syncMusicBtns() { document.querySelectorAll('.music-btn').forEach(b => { b.textContent = isMusicOn() ? '🔊' : '🔇'; }); }
document.querySelectorAll('.music-btn').forEach(b => b.addEventListener('click', e => {
  e.stopPropagation(); unlockAudio(); toggleMusic(); syncMusicBtns();
  if (!state.game || state.game.over) playMusic('lobby');
}));
syncMusicBtns();

// ---------- 타이틀 ----------
$('#title-pigs').innerHTML = PIG_ORDER.map(id => `<img src="${pigDataURL(id)}" alt="">`).join('');
$('#btn-start').addEventListener('click', () => { unlockAudio(); sfx('click'); buildSelect(); show('scr-select'); });
$('#btn-online').addEventListener('click', () => { unlockAudio(); sfx('click'); openOnline(); });

// ---------- 도감 (돼지 / 가챠 / 아이템) : data.js 내용으로 자동 생성 ----------
document.querySelectorAll('[data-info]').forEach(b => b.addEventListener('click', () => { unlockAudio(); sfx('click'); buildInfo(b.dataset.info); show('scr-info'); }));
document.querySelectorAll('#info-tabs button').forEach(b => b.addEventListener('click', () => { sfx('click'); buildInfo(b.dataset.tab); }));
$('#btn-info-back').addEventListener('click', () => { sfx('click'); show('scr-title'); });

function buildInfo(tab) {
  document.querySelectorAll('#info-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const body = $('#info-body');
  body.scrollTop = 0;
  if (tab === 'pigs') {
    body.innerHTML = PIG_ORDER.map(id => {
      const p = PIGS[id];
      return `<div class="info-row"><img src="${pigDataURL(id)}" alt="">
        <div><div class="nm">${p.name} <span class="tag ${p.passive ? 'pass' : ''}">${p.passive ? '패시브' : '스킬'}</span></div>
        <div class="sk">${p.skill} · ${p.passive ? `${p.cd}초마다 다시 활성화` : `재사용 ${p.cd}초`}</div>
        <div class="ds">${p.desc}</div></div></div>`;
    }).join('') + `<p class="hint">모든 돼지는 기본 능력치가 같아요. 속도·폭탄·화력은 아이템으로 키워요.</p>`;
  } else if (tab === 'perks') {
    const tiers = Object.entries(RARITY).filter(([k]) => PERKS.some(p => p.rarity === k));
    const total = tiers.reduce((sum, [, v]) => sum + v.w, 0);
    let html = tiers.map(([k, v]) => {
      const list = PERKS.filter(p => p.rarity === k);
      const tp = v.w / total * 100;
      return `<div class="tier" style="--rc:${v.color}"><div class="tier-h">${v.name}<span>${tp.toFixed(1)}%</span></div>` +
        list.map(p => `<div class="perk"><div class="nm">${p.name}<span>${(tp / list.length).toFixed(1)}%</span></div><div class="ds">${p.desc}</div></div>`).join('') +
        `</div>`;
    }).join('');
    const empty = Object.entries(RARITY).filter(([k]) => !PERKS.some(p => p.rarity === k)).map(([, v]) => v.name);
    if (empty.length) html += `<p class="hint">아직 특성이 없는 등급: ${empty.join(', ')} (추가되면 확률이 자동으로 다시 계산돼요)</p>`;
    body.innerHTML = `<p class="hint">대결 시작 때 모든 돼지가 한 번씩 뽑아요. 퍼센트는 한 번 뽑을 때 나올 확률이에요.</p>` + html;
  } else {
    body.innerHTML = Object.values(ITEMS).map(it => `<div class="info-row"><img src="assets/common/${it.icon}.png" alt="">
      <div><div class="nm">${it.name}</div><div class="ds">${it.desc}</div><div class="sk">최대: ${it.maxText}</div></div></div>`).join('') +
      `<p class="hint">부서지는 블록에서 가끔, "?" 특수 상자에서는 반드시 나와요. 최대치를 넘으면 먹어도 효과가 없어요.</p>`;
  }
}

// ---------- 혼자 하기: 돼지 선택 ----------
function buildSelect() {
  const box = $('#pig-cards');
  box.innerHTML = '';
  for (const id of PIG_ORDER) {
    const p = PIGS[id];
    const el = document.createElement('div');
    el.className = 'card' + (state.myPig === id ? ' sel' : '');
    el.innerHTML = `
      <img src="${pigDataURL(id)}" alt="">
      <div class="nm">${p.name}</div>
      <div class="sk">스킬: ${p.skill}</div>
      <div class="ds">${p.desc}</div>`;
    el.addEventListener('click', () => {
      sfx('click');
      state.myPig = id;
      box.querySelectorAll('.card').forEach(c => c.classList.remove('sel'));
      el.classList.add('sel');
      $('#btn-to-gacha').disabled = false;
    });
    box.appendChild(el);
  }
  $('#btn-to-gacha').disabled = !state.myPig;
}
$('#btn-to-gacha').addEventListener('click', () => { sfx('confirm'); startSolo(); });
$('#btn-select-back').addEventListener('click', () => { sfx('click'); show('scr-title'); });

function startSolo() {
  const setups = [{ name: '나', pigId: state.myPig, color: PLAYER_COLORS[0] }];
  for (let i = 0; i < 3; i++) {
    setups.push({ name: BOT_NAMES[i], pigId: PIG_ORDER[Math.floor(Math.random() * 4)], isBot: true, color: PLAYER_COLORS[i + 1] });
  }
  for (const s of setups) s.perkId = rollPerk().id;
  beginMatch({ map: pickMap(), setups, mode: 'solo', meIdx: 0 });
}

// ---------- 대결 시작 (혼자/방장/참가자 공통) ----------
async function beginMatch({ map, setups, mode, meIdx }) {
  await ensureAssets(map);
  clearTimeout(net.backTimer);
  $('#result').classList.add('hidden');
  input.reset();
  state.mode = mode; state.meIdx = meIdx; state.session = null;
  const g = new Game(map, setups, { sfx, toast, onEnd: onGameEnd });
  g.ready = Infinity;     // 가챠가 끝날 때까지 정지
  g.reveal = false;       // 얻은 특성은 가챠가 끝난 뒤에 공개
  if (mode === 'host') {
    const s = new HostSession(g, net.online);
    state.session = s;
    const r2 = v => Math.round(v * 100) / 100;
    g.hooks.sfx = n => { sfx(n); s.ev(['s', n]); };
    g.hooks.toast = m => { toast(m); s.ev(['to', m]); };
    g.hooks.float = (x, y, t, c) => s.ev(['fl', r2(x), r2(y), t, c]);
    g.hooks.fx = e => s.ev(['fx', e]);
    g.hooks.onEnd = w => { s.flush(); onGameEnd(w); };
  } else if (mode === 'client') {
    state.session = new ClientSession(g, net.online, meIdx, { sfx, toast, onEnd: onGameEnd });
  }
  state.game = g;
  if (import.meta.env.DEV) window.__game = g; // 개발 중 디버그용
  const me = g.players[meIdx];
  $('#skill-name').textContent = me.pig.skill;
  $('#btn-skill').classList.toggle('passive', !!me.pig.passive);   // 텟카이: 자동 발동
  $('#btn-again').classList.toggle('hidden', mode !== 'solo');
  $('#btn-change').classList.toggle('hidden', mode !== 'solo');
  updateHud(g);
  show('scr-game');
  runGacha(setups, g, () => {
    if (mode !== 'client') { g.reveal = true; g.ready = 2.6; }   // 참가자는 방장 상태를 따라감
    playMusic('battle');
    sfx('confirm');
  });
}

// ---------- 가챠 (인게임 화면 위에 슬롯 릴을 띄움) ----------
const SLOT_H = 56;
function runGacha(setups, g, onDone) {
  const rows = $('#gacha-rows');
  rows.innerHTML = '';
  const N = 24; // 결과가 나오기 전에 지나가는 칸 수
  const reels = setups.map(s => {
    const k = PERKS.find(p => p.id === s.perkId) || PERKS[0];
    let cells = '';
    for (let i = 0; i < N; i++) {
      const f = PERKS[Math.floor(Math.random() * PERKS.length)];
      cells += `<div class="cell" style="color:${RARITY[f.rarity].color}"><div class="pn">${f.name}</div></div>`;
    }
    cells += `<div class="cell"><div class="rr">${RARITY[k.rarity].name}</div><div class="pn">${k.name}</div><div class="pd">${k.desc}</div></div>`;
    const row = document.createElement('div');
    row.className = 'grow';
    row.style.setProperty('--c', s.color);
    row.innerHTML = `
      <img src="${pigDataURL(s.pigId)}" alt="">
      <div class="who">${esc(s.name)}<small>${PIGS[s.pigId].name}</small></div>
      <div class="slot"><div class="strip">${cells}</div></div>`;
    rows.appendChild(row);
    return { slot: row.querySelector('.slot'), strip: row.querySelector('.strip'), k };
  });
  $('#gacha-overlay').classList.remove('hidden');
  sfx('spin');

  // 화면 크기를 잡고 게임 루프를 시작한 뒤, 릴을 굴린다 (뒤로 갈수록 오래 돎)
  requestAnimationFrame(() => {
    resize();
    startLoop();
    requestAnimationFrame(() => reels.forEach((r, i) => {
      const dur = 2000 + i * 550;
      r.strip.style.transition = `transform ${dur}ms cubic-bezier(.12,.72,.18,1)`;
      r.strip.style.transform = `translateY(${-N * SLOT_H}px)`;
      setTimeout(() => {
        if (state.game !== g) return; // 그 사이 다른 판으로 넘어간 경우
        r.slot.classList.add('done', r.k.rarity, 'pop');
        sfx(r.k.rarity === 'legend' ? 'legend' : 'reveal');
        if (i === reels.length - 1) setTimeout(() => {
          if (state.game !== g) return;
          $('#gacha-overlay').classList.add('hidden');   // 가챠 패널이 사라지고
          onDone();                                      // 특성 공개 + 준비 -> 시작
        }, 1100);
      }, dur);
    }));
  });
}

// ---------- 대결 ----------
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

function resize() {
  const g = state.game;
  if (!g) return;
  const W = g.cols * TILE, H = g.rows * TILE;
  const stage = $('#stage').getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  let dev = Math.min(stage.width / W, stage.height / H) * dpr;
  // 저해상도 화면에서만 정수 배율로 맞춤 (고해상도 폰은 꽉 차게)
  if (dpr < 2 && dev >= 2) dev = Math.floor(dev);
  view.scale = dev;
  world.width = W; world.height = H;
  cv.width = Math.round(W * dev);
  cv.height = Math.round(H * dev);
  cv.style.width = (W * dev / dpr) + 'px';
  cv.style.height = (H * dev / dpr) + 'px';
}
addEventListener('resize', resize);

const themeCache = {};
async function ensureAssets(map) {
  if (!state.assets) {
    state.assets = { common: await loadCommon(), flame: await loadFlames(), pigs: await buildPigSprites(PIG_ORDER) };
  }
  const name = map.theme || 'farm';
  if (!themeCache[name]) themeCache[name] = await loadTheme(name);
  state.assets.theme = themeCache[name];
  return state.assets;
}

let last = 0;
let hudAcc = 0;
let loopId = 0;
function startLoop() {  // 새 판이 시작되면 이전 루프는 자동으로 멈춤
  const id = ++loopId;
  last = performance.now();
  const tick = ts => {
    if (id !== loopId || !state.game) return;
    frame(ts);
    if (!state.game.over) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function stopGame() { loopId++; state.game = null; state.session = null; net.online?.unwatchGame(); }

function frame(ts) {
  const g = state.game;
  if (!g) return;
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;
  const me = g.players[state.meIdx];
  if (state.mode === 'client') {
    if (g.ready > 0) input.reset();     // 시작 전에 누른 버튼은 무시
    state.session.tick(dt, input.consume());
  } else {
    if (g.ready > 0) input.reset();
    const inputFor = (p, pdt) => (p.isBot ? botInput(g, p, pdt) : p.remote ? state.session.remoteInput(p) : input.consume());
    if (state.mode === 'host') state.session.tick(dt, inputFor);
    else g.update(dt, inputFor);
    if (state.mode === 'solo' && !me.alive) g.forceEnd(1.5);
  }

  wctx.setTransform(1, 0, 0, 1, 0, 0);
  wctx.imageSmoothingEnabled = false;
  render(wctx, g, state.assets, me);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;       // 한 번에 부드럽게 확대 -> 칸 사이 가는 줄이 생기지 않음
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(world, 0, 0, cv.width, cv.height);

  hudAcc += dt;
  if (hudAcc > 0.1) { hudAcc = 0; updateHud(g); }
}

function updateHud(g) {
  const left = Math.max(0, Math.ceil(g.timeLimit - g.time));
  $('#timer').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('#hud-players').innerHTML = g.players.map(p => `
    <div class="hp ${p.alive ? '' : 'dead'}" style="--c:${p.color}">
      ${esc(p.name)}${p.lives > 1 && p.alive && g.reveal ? ' ♥' + p.lives : ''}<small>${p.perk && g.reveal ? p.perk.name : ''}</small>
    </div>`).join('');
  const me = g.players[state.meIdx];
  $('#mystats').innerHTML = !g.reveal ? '' : `<span>💣 <b>${me.maxBombs}</b></span><span>🔥 <b>${me.range}</b></span><span>👟 <b>${me.items.speed}/${SPEED_ITEM_MAX}</b></span>`;
  const remain = Math.max(0, me.skillReadyAt - g.time);
  $('#skill-cd').style.height = (remain > 0 ? (remain / me.pig.cd) * 100 : 0) + '%';
}

function onGameEnd(winner) {
  const g = state.game;
  if (!g) return;
  const me = g.players[state.meIdx];
  updateHud(g);
  stopMusic();
  let title, sub;
  if (winner === me) { title = '승리!'; sub = `${me.pig.name} + ${me.perk?.name ?? ''} 조합으로 우승!`; sfx('win'); }
  else if (!me.alive) { title = '탈락...'; sub = winner ? `${winner.name}(${winner.pig.name}) 승리` : '다음 판에 복수하자'; sfx('lose'); }
  else { title = '무승부'; sub = '시간 종료!'; sfx('lose'); }
  if (state.mode !== 'solo') sub += ' · 잠시 후 방으로 돌아가요';
  $('#result-title').textContent = title;
  $('#result-sub').textContent = sub;
  setTimeout(() => $('#result').classList.remove('hidden'), 300);
  if (state.mode === 'host') {   // 방장: 5초 뒤 모두 방으로
    net.backTimer = setTimeout(() => { net.online.endGame(); net.online.resetReady(Object.keys(net.players)); }, 5000);
  }
}

$('#btn-again').addEventListener('click', () => { sfx('click'); stopGame(); startSolo(); });
$('#btn-change').addEventListener('click', () => { sfx('click'); stopGame(); buildSelect(); show('scr-select'); });

// =====================================================================
// 온라인
// =====================================================================
function openOnline() {
  if (!FIREBASE_CONFIG) { toastTitle('온라인 서버를 준비하고 있어요. 조금만 기다려 주세요!'); return; }
  try { $('#nick').value = localStorage.getItem('gpb.nick') || ''; net.pig = localStorage.getItem('gpb.pig') || 'soldier'; } catch { /* 무시 */ }
  $('#online-msg').textContent = '';
  show('scr-online');
}
function toastTitle(msg) { const el = $('#title-msg'); el.textContent = msg; setTimeout(() => { el.textContent = ''; }, 3000); }

$('#btn-online-back').addEventListener('click', () => { sfx('click'); show('scr-title'); });
$('#btn-online-enter').addEventListener('click', async () => {
  const nick = $('#nick').value.trim().slice(0, 10);
  if (!nick) { $('#online-msg').textContent = '닉네임을 적어 주세요.'; return; }
  net.nick = nick;
  try { localStorage.setItem('gpb.nick', nick); } catch { /* 무시 */ }
  $('#online-msg').textContent = '접속 중...';
  try {
    net.online ??= new Online(FIREBASE_CONFIG, ONLINE);
    const r = await net.online.connect();
    if (r.full) { $('#online-msg').textContent = '지금 접속한 사람이 너무 많아요. 잠시 뒤에 다시 해 주세요.'; return; }
    enterLobby();
  } catch (e) {
    $('#online-msg').textContent = '서버에 연결하지 못했어요: ' + (e.message || e);
  }
});

// ---------- 로비 ----------
function enterLobby(msg = '') {
  $('#lobby-msg').textContent = msg;
  $('#create-panel').classList.add('hidden');
  show('scr-lobby');
  if (!net.lobbyOn) {
    net.lobbyOn = true;
    net.online.watchLobby(renderLobby);
    net.online.watchPresence(n => { $('#lobby-count').textContent = `접속 ${n}명`; });
  }
}

function renderLobby(list) {
  const box = $('#room-list');
  if (!list.length) { box.innerHTML = '<p class="hint">아직 방이 없어요. 방을 만들어 보세요!</p>'; return; }
  box.innerHTML = list.map(r => {
    const old = (r.v || 'dev') !== VERSION, playing = r.status === 'playing', full = (r.count || 0) >= ONLINE.maxPlayers;
    const tag = old ? '버전 다름' : playing ? '게임 중' : full ? '가득 참' : '참가';
    return `<button class="room-row" data-id="${esc(r.id)}" ${old || playing || full ? 'disabled' : ''}>
      <div><b>${r.hasPw ? '🔒 ' : ''}${esc(r.name)}</b><small>방장 ${esc(r.hostName)} · ${esc(getMap(r.map)?.name || r.map)}</small></div>
      <span class="cnt">${r.count || 1}/${ONLINE.maxPlayers}</span><span class="tag2">${tag}</span></button>`;
  }).join('');
  box.querySelectorAll('.room-row').forEach(b => b.addEventListener('click', () => joinFlow(list.find(r => r.id === b.dataset.id))));
}

$('#btn-create-room').addEventListener('click', () => {
  sfx('click');
  $('#room-name').value = `${net.nick}의 방`;
  $('#room-pw').value = '';
  $('#room-map').innerHTML = MAP_IDS.map(id => `<option value="${id}" ${id === DEFAULT_MAP ? 'selected' : ''}>${esc(getMap(id).name || id)}</option>`).join('');
  $('#create-panel').classList.remove('hidden');
});
$('#btn-create-cancel').addEventListener('click', () => { sfx('click'); $('#create-panel').classList.add('hidden'); });
$('#btn-create-ok').addEventListener('click', async () => {
  sfx('confirm');
  const name = $('#room-name').value.trim().slice(0, 20) || `${net.nick}의 방`;
  try {
    await net.online.createRoom({ name, pw: $('#room-pw').value.trim(), map: $('#room-map').value, nickname: net.nick, pig: net.pig });
    enterRoom();
  } catch (e) { $('#lobby-msg').textContent = '방을 만들지 못했어요: ' + (e.message || e); }
});
$('#btn-lobby-back').addEventListener('click', async () => {
  sfx('click');
  net.lobbyOn = false;
  await net.online.disconnect().catch(() => {});
  show('scr-title');
});

async function joinFlow(room) {
  if (!room) return;
  sfx('click');
  let pw = '';
  if (room.hasPw) { pw = prompt('비밀번호를 입력해 주세요'); if (pw === null) return; }
  const r = await net.online.joinRoom(room.id, pw, net.nick, net.pig);
  if (r.error) { $('#lobby-msg').textContent = r.error; return; }
  enterRoom();
}

// ---------- 방 ----------
function enterRoom() {
  net.meta = null; net.players = {}; net.startSeq = null;
  $('#room-msg').textContent = '';
  show('scr-room');
  net.online.watchRoom({ meta: onRoomMeta, players: onRoomPlayers });
  net.online.watchGameStart(onGameStart);
}

async function leaveToLobby(msg = '') {
  stopGame();
  await net.online.leaveRoom().catch(() => {});
  enterLobby(msg);
}
$('#btn-room-leave').addEventListener('click', () => { sfx('click'); leaveToLobby(); });

function onRoomMeta(meta) {
  if (!meta) {   // 방이 사라짐 = 방장이 나감
    if (net.online.room && !net.online.room.host) leaveToLobby('방장이 나가서 방이 닫혔어요.');
    return;
  }
  net.meta = meta;
  if (meta.status === 'lobby' && state.game && state.mode !== 'solo') { stopGame(); show('scr-room'); }
  renderRoom();
}

function onRoomPlayers(players) {
  if (state.mode === 'host' && state.session && state.game && !state.game.over) {
    for (const [uid, p] of Object.entries(net.players)) if (!players[uid]) state.session.playerLeft(uid, p.name);
  }
  net.players = players;
  if (net.online.room?.host) net.online.setMeta({ count: Object.keys(players).length });
  renderRoom();
}

const sortedPlayers = () => Object.entries(net.players).map(([uid, p]) => ({ uid, ...p })).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));

function renderRoom() {
  const meta = net.meta;
  if (!meta || !$('#scr-room').classList.contains('active')) return;
  const host = !!net.online.room?.host;
  const list = sortedPlayers();
  const me = net.players[net.online.uid] || {};
  const bots = meta.bots !== false;
  $('#room-title').textContent = meta.name;
  $('#room-map-label').textContent = getMap(meta.map)?.name || meta.map;

  let html = '';
  for (let i = 0; i < ONLINE.maxPlayers; i++) {
    const p = list[i];
    if (p) {
      const isHost = p.uid === meta.host;
      const badge = isHost ? '<span class="badge host">방장</span>' : p.ready ? '<span class="badge ok">준비</span>' : '<span class="badge">대기</span>';
      html += `<div class="slot-row" style="--c:${PLAYER_COLORS[i]}"><img src="${pigDataURL(PIGS[p.pig] ? p.pig : 'soldier')}" alt="">
        <div class="nm">${esc(p.name)}${p.uid === net.online.uid ? ' <small>(나)</small>' : ''}<small>${PIGS[p.pig]?.name || ''}</small></div>${badge}</div>`;
    } else {
      html += `<div class="slot-row empty" style="--c:${PLAYER_COLORS[i]}"><div class="nm">${bots ? '빈자리 · 봇이 들어가요' : '빈자리'}</div></div>`;
    }
  }
  $('#room-slots').innerHTML = html;

  const locked = !host && me.ready;
  $('#room-pigs').innerHTML = PIG_ORDER.map(id => `<button class="pick ${me.pig === id ? 'sel' : ''}" data-pig="${id}" ${locked ? 'disabled' : ''}>
    <img src="${pigDataURL(id)}" alt=""><span>${PIGS[id].name}</span></button>`).join('');
  $('#room-pigs').querySelectorAll('.pick').forEach(b => b.addEventListener('click', () => {
    sfx('click'); net.pig = b.dataset.pig;
    try { localStorage.setItem('gpb.pig', net.pig); } catch { /* 무시 */ }
    net.online.setMyPlayer({ pig: net.pig });
  }));

  $('#room-host').classList.toggle('hidden', !host);
  if (host) {
    const sel = $('#room-map-select');
    if (!sel.options.length) sel.innerHTML = MAP_IDS.map(id => `<option value="${id}">${esc(getMap(id).name || id)}</option>`).join('');
    sel.value = meta.map;
    $('#room-bots').checked = bots;
  }
  const others = list.filter(p => p.uid !== meta.host);
  const allReady = others.every(p => p.ready);
  const total = list.length + (bots ? ONLINE.maxPlayers - list.length : 0);
  const btn = $('#btn-room-main');
  if (host) {
    btn.textContent = '게임 시작';
    btn.disabled = !allReady || total < 2;
    $('#room-msg').textContent = total < 2 ? '혼자서는 시작할 수 없어요. 봇을 켜거나 친구를 기다려 주세요.' : !allReady ? '모두 준비하면 시작할 수 있어요.' : '';
  } else {
    btn.disabled = false;
    btn.textContent = me.ready ? '준비 취소' : '준비';
    $('#room-msg').textContent = me.ready ? '방장이 시작하기를 기다리는 중...' : '돼지를 고르고 준비를 눌러 주세요.';
  }
}

$('#room-map-select').addEventListener('change', e => net.online.setMeta({ map: e.target.value }));
$('#room-bots').addEventListener('change', e => net.online.setMeta({ bots: e.target.checked }));
$('#btn-room-main').addEventListener('click', () => {
  sfx('confirm');
  if (net.online.room?.host) startOnline();
  else net.online.setMyPlayer({ ready: !(net.players[net.online.uid] || {}).ready });
});

// 방장: 참가자 + (봇) 구성과 가챠 결과를 정해서 모두에게 알림
function startOnline() {
  const meta = net.meta;
  const list = sortedPlayers().slice(0, ONLINE.maxPlayers);
  const setups = list.map((p, i) => ({ uid: p.uid, name: p.name, pigId: PIGS[p.pig] ? p.pig : 'soldier', color: PLAYER_COLORS[i], remote: p.uid !== net.online.uid }));
  if (meta.bots !== false) {
    for (let i = setups.length, b = 0; i < ONLINE.maxPlayers; i++, b++) {
      setups.push({ uid: '', name: BOT_NAMES[b], pigId: PIG_ORDER[Math.floor(Math.random() * 4)], color: PLAYER_COLORS[i], isBot: true, remote: false });
    }
  }
  for (const s of setups) s.perkId = rollPerk().id;
  net.online.startGame({ map: getMap(meta.map) ? meta.map : DEFAULT_MAP, setups, seq: Date.now() });
}

function onGameStart(start) {
  if (!start || start.seq === net.startSeq) return;
  net.startSeq = start.seq;
  const setups = (start.setups || []).map(s => ({ ...s }));
  const meIdx = setups.findIndex(s => s.uid === net.online.uid);
  if (meIdx < 0) return;
  beginMatch({ map: getMap(start.map) ?? getMap(DEFAULT_MAP), setups, mode: net.online.room?.host ? 'host' : 'client', meIdx });
}
