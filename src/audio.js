// 효과음: Kenney 효과음(mp3) + 코드로 합성한 레트로 효과음(폭발 등)
let ctx = null;
let noiseBuf = null;
const bufs = {};
const FILES = ['break', 'punch', 'dash', 'click', 'confirm', 'spin', 'reveal', 'legend', 'win', 'lose'];

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    for (const name of FILES) {
      fetch(`sfx/${name}.mp3`).then(r => r.arrayBuffer())
        .then(ab => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
        .then(b => { bufs[name] = b; }).catch(() => {});
    }
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function gainNode(vol, dur) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  g.connect(ctx.destination);
  return g;
}

function tone(type, f0, f1, dur, vol) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(f1, ctx.currentTime + dur);
  o.connect(gainNode(vol, dur));
  o.start(); o.stop(ctx.currentTime + dur);
}

function noise(dur, vol, f0, f1, type = 'lowpass') {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(f0, ctx.currentTime);
  f.frequency.exponentialRampToValueAtTime(f1, ctx.currentTime + dur);
  s.connect(f); f.connect(gainNode(vol, dur));
  s.start(); s.stop(ctx.currentTime + dur);
}

const SYNTH = {
  boom:   v => { noise(0.55, 0.9 * v, 1800, 80); tone('sine', 120, 35, 0.4, 0.8 * v); },
  place:  v => tone('sine', 260, 120, 0.09, 0.5 * v),
  pickup: v => { tone('square', 520, 1100, 0.12, 0.18 * v); },
  hit:    v => tone('square', 320, 90, 0.25, 0.25 * v),
  die:    v => tone('sawtooth', 500, 50, 0.6, 0.25 * v),
  throw:  v => noise(0.25, 0.4 * v, 600, 3000, 'bandpass'),
};

export function sfx(name, vol = 1) {
  if (!ctx) return;
  try {
    if (SYNTH[name]) return SYNTH[name](vol);
    const b = bufs[name];
    if (!b) return;
    const s = ctx.createBufferSource();
    s.buffer = b;
    const g = ctx.createGain();
    g.gain.value = 0.7 * vol;
    s.connect(g); g.connect(ctx.destination);
    s.start();
  } catch { /* 소리 실패는 무시 */ }
}

// ---------- 배경음악: 코드로 작곡한 8비트 루프 (저작권 걱정 없음) ----------
// 노트: 'C5' 같은 음 이름, '.' = 쉼표. 한 칸 = 8분음표
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const freq = n => { const m = n.match(/^([A-G]#?)(\d)$/); return 440 * 2 ** ((NOTE[m[1]] + (Number(m[2]) + 1) * 12 - 69) / 12); };
const seq = s => s.trim().split(/\s+/);

const SONGS = {
  // 대결: 신나는 140bpm, 8마디 반복
  battle: { bpm: 140, lead: 0.05, bassVol: 0.11, drums: true,
    melody: seq(`E5 . G5 . A5 G5 E5 .   D5 . E5 . C5 . . .   E5 . G5 . A5 . C6 .   B5 A5 G5 . A5 . . .
                 F5 . A5 . C6 A5 F5 .   E5 . G5 . C6 . . .   D5 E5 F5 . E5 D5 C5 .   D5 . . . G4 . . .`),
    bass: seq(`C3 . C4 . C3 . C4 .   A2 . A3 . A2 . A3 .   C3 . C4 . C3 . C4 .   G2 . G3 . G2 . G3 .
               F2 . F3 . F2 . F3 .   C3 . C4 . C3 . C4 .   D3 . D4 . G2 . G3 .   G2 . G3 . G2 . B2 .`) },
  // 대기실: 잔잔한 100bpm 아르페지오
  lobby: { bpm: 100, lead: 0.035, bassVol: 0.08, drums: false,
    melody: seq(`C5 E5 G5 E5 C5 E5 G5 E5   B4 D5 G5 D5 B4 D5 G5 D5   A4 C5 E5 C5 A4 C5 E5 C5   A4 C5 F5 C5 A4 C5 F5 C5`),
    bass: seq(`C3 . . . G2 . . .   G2 . . . D3 . . .   A2 . . . E3 . . .   F2 . . . C3 . . .`) },
};

let musicOn = true;
try { musicOn = localStorage.getItem('gpb.music') !== '0'; } catch { /* 저장 불가 환경 */ }
let musicGain = null, musicTimer = null, current = null, step = 0, nextAt = 0;

function voice(type, f, t, dur, vol) {
  const o = ctx.createOscillator(), gn = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(gn); gn.connect(musicGain); o.start(t); o.stop(t + dur + 0.02);
}
function drum(kind, t) {
  if (kind === 'k') {
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    gn.gain.setValueAtTime(0.28, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(gn); gn.connect(musicGain); o.start(t); o.stop(t + 0.15);
    return;
  }
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
  s.buffer = noiseBuf;
  f.type = kind === 'h' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'h' ? 7000 : 1800;
  const dur = kind === 'h' ? 0.03 : 0.1;
  gn.gain.setValueAtTime(kind === 'h' ? 0.05 : 0.13, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(gn); gn.connect(musicGain); s.start(t); s.stop(t + dur);
}

function schedule() {
  const song = SONGS[current];
  const len = 60 / song.bpm / 2;              // 8분음표 길이(초)
  while (nextAt < ctx.currentTime + 0.25) {   // 0.25초 앞까지 미리 예약
    const m = song.melody[step % song.melody.length], b = song.bass[step % song.bass.length];
    if (m !== '.') voice('square', freq(m), nextAt, len * 0.9, song.lead);
    if (b !== '.') voice('triangle', freq(b), nextAt, len * 1.6, song.bassVol);
    if (song.drums) {
      const s8 = step % 8;
      if (s8 === 0 || s8 === 4) drum('k', nextAt);
      if (s8 === 2 || s8 === 6) drum('s', nextAt);
      if (s8 % 2 === 1) drum('h', nextAt);
    }
    step++; nextAt += len;
  }
}

export function playMusic(name) {
  if (!ctx || !SONGS[name]) return;
  if (current === name && musicTimer) return;
  stopMusic();
  current = name; step = 0;
  if (!musicGain) { musicGain = ctx.createGain(); musicGain.connect(ctx.destination); }
  musicGain.gain.value = musicOn ? 0.55 : 0;
  nextAt = ctx.currentTime + 0.05;
  musicTimer = setInterval(schedule, 60);
  schedule();
}
export function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null; current = null;
}
export function isMusicOn() { return musicOn; }
export function toggleMusic() {
  musicOn = !musicOn;
  try { localStorage.setItem('gpb.music', musicOn ? '1' : '0'); } catch { /* 무시 */ }
  if (musicGain) musicGain.gain.value = musicOn ? 0.55 : 0;
  return musicOn;
}
