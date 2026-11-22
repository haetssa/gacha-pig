// 키보드 + 화면 조이스틱/버튼 입력
const KEY_DIR = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
};

export class Input {
  constructor() {
    this.keys = [];
    this.joyDir = null;
    this.bombQ = false;
    this.skillQ = false;
    this.bindKeyboard();
    this.bindJoystick();
    this.bindButton('#btn-bomb', () => { this.bombQ = true; });
    this.bindButton('#btn-skill', () => { this.skillQ = true; });
  }

  reset() { this.keys = []; this.joyDir = null; this.bombQ = this.skillQ = false; }

  consume() {
    const r = { dir: this.joyDir || this.keys[this.keys.length - 1] || null, bomb: this.bombQ, skill: this.skillQ };
    this.bombQ = this.skillQ = false;
    return r;
  }

  bindKeyboard() {
    addEventListener('keydown', e => {
      const d = KEY_DIR[e.code];
      if (d) { e.preventDefault(); if (!this.keys.includes(d)) this.keys.push(d); return; }
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'KeyJ') { e.preventDefault(); this.bombQ = true; }
      if (e.code === 'KeyK' || e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') { e.preventDefault(); this.skillQ = true; }
    });
    addEventListener('keyup', e => {
      const d = KEY_DIR[e.code];
      if (d) this.keys = this.keys.filter(k => k !== d);
    });
    addEventListener('blur', () => { this.keys = []; });
  }

  // 십자 방향키: 손가락이 십자 중심에서 어느 쪽에 있는지로 방향을 정한다 (누른 채 미끄러뜨려도 바뀜)
  bindJoystick() {
    const zone = document.querySelector('#joy');
    const pad = document.querySelector('#dpad');
    const arms = Object.fromEntries(['up', 'down', 'left', 'right'].map(d => [d, pad.querySelector('.arm.' + d)]));
    let pid = null;
    const light = dir => { for (const [d, el] of Object.entries(arms)) el.classList.toggle('on', d === dir); };
    const update = e => {
      const r = pad.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      this.joyDir = Math.hypot(dx, dy) < r.width * 0.1 ? null   // 가운데를 누르면 정지
        : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      light(this.joyDir);
    };
    zone.addEventListener('pointerdown', e => { pid = e.pointerId; zone.setPointerCapture(pid); update(e); });
    zone.addEventListener('pointermove', e => { if (e.pointerId === pid) update(e); });
    const end = e => { if (e.pointerId !== pid) return; pid = null; this.joyDir = null; light(null); };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  bindButton(sel, fn) {
    const el = document.querySelector(sel);
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.classList.add('pressed'); fn(); });
    const up = () => el.classList.remove('pressed');
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('pointercancel', up);
  }
}
