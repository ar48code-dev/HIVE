import { C, TAU, drawBee, drawWasp, hexPath, type Ctx } from './draw.js';

/** Small seeded generator so the scene (and its tests) are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Signed shortest turn from angle a to angle b. */
export const turn = (a: number, b: number) => ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

interface Cell { x: number; y: number; ring: number; glow: number; phase: number }
interface Trail { x: number; y: number }
interface Bee {
  x: number; y: number; vx: number; vy: number; ang: number; flap: number; trail: Trail[];
  state: 'patrol' | 'wait' | 'arrive';
  orbitR: number; orbitW: number; orbitA: number; ratio: number; phase: number; curious: boolean;
  carry: number; wait: number; p: Array<[number, number]>; t: number; dur: number; cell: number;
}
interface Wasp { x: number; y: number; vx: number; vy: number; ang: number; flap: number; alpha: number; tx: number; ty: number; hop: number; leaving: boolean; cool: number; trail: Trail[] }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; ttl: number; size: number; color: string }
interface Ripple { x: number; y: number; r: number; life: number; ttl: number; max: number }
interface Hit { angle: number; life: number }
interface Pollen { x: number; y: number; vx: number; vy: number; size: number; phase: number }

export const MAX_BEES = 22;
export const MAX_WASPS = 5;

export class HiveSim {
  w = 0; h = 0; time = 0;
  cx = 0; cy = 0; cell = 16; shieldR = 80;
  cells: Cell[] = [];
  bees: Bee[] = [];
  wasps: Wasp[] = [];
  sparks: Spark[] = [];
  ripples: Ripple[] = [];
  hits: Hit[] = [];
  pollen: Pollen[] = [];
  threat = { open: 0, high: 0 };
  flareLevel = 0;
  pointer = { x: 0, y: 0, active: false };
  private rand: () => number;
  private ambient = 0;
  private queenFlap = 0;

  constructor(seed = 7) { this.rand = rng(seed); }

  resize(w: number, h: number) {
    const first = this.w === 0;
    this.w = w; this.h = h;
    const narrow = w < 640;
    this.cx = w * (narrow ? 0.68 : 0.71);
    this.cy = h * (narrow ? 0.47 : 0.52);
    this.cell = clamp(Math.min(h * 0.085, w * 0.042), 9, 22);
    const sp = Math.sqrt(3) * this.cell;
    this.cells = [];
    for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) {
      const s = -q - r;
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
      if (ring > 3) continue;
      this.cells.push({ x: this.cx + sp * (q + r / 2), y: this.cy + 1.5 * this.cell * r, ring, glow: 0, phase: this.rand() * TAU });
    }
    this.cells.sort((a, b) => a.ring - b.ring);
    this.shieldR = sp * 3.7;
    if (first) this.populate();
    else this.pollenInit();
  }

  private populate() {
    const n = clamp(Math.round(this.w / 80), 8, 16);
    for (let i = 0; i < n; i++) this.bees.push(this.newPatrolBee(i === 0 || i === 7));
    this.pollenInit();
  }

  private pollenInit() {
    const n = clamp(Math.round(this.w / 14), 30, 90);
    this.pollen = Array.from({ length: n }, () => ({ x: this.rand() * this.w, y: this.rand() * this.h, vx: 3 + this.rand() * 8, vy: -2 - this.rand() * 6, size: 0.6 + this.rand() * 1.6, phase: this.rand() * TAU }));
  }

  private newPatrolBee(curious = false): Bee {
    const a = this.rand() * TAU;
    const R = this.cell * (3.4 + this.rand() * 5.2);
    return {
      x: this.cx + Math.cos(a) * R, y: this.cy + Math.sin(a) * R, vx: 0, vy: 0, ang: a + Math.PI / 2, flap: this.rand() * TAU, trail: [],
      state: 'patrol', orbitR: R, orbitW: (0.35 + this.rand() * 0.55) * (this.rand() < 0.5 ? -1 : 1), orbitA: a, ratio: 0.55 + this.rand() * 0.4,
      phase: this.rand() * TAU, curious, carry: 0, wait: 0, p: [], t: 0, dur: 0, cell: 0,
    };
  }

  /** A payment arrived: that many bees fly in carrying honey and light up a cell. */
  arrive(count: number) {
    const n = clamp(Math.round(count), 0, 8);
    for (let i = 0; i < n; i++) {
      if (this.bees.length >= MAX_BEES) { // recycle a patrolling bee instead of growing without bound
        const idx = this.bees.findIndex((b) => b.state === 'patrol' && !b.curious);
        if (idx < 0) break;
        this.bees.splice(idx, 1);
      }
      const edge = this.rand();
      const start: [number, number] = edge < 0.5 ? [-24, this.rand() * this.h] : edge < 0.8 ? [this.rand() * this.w * 0.6, -24] : [this.rand() * this.w * 0.6, this.h + 24];
      const cell = this.cells.length > 7 ? 7 + Math.floor(this.rand() * (this.cells.length - 7)) : 0;
      const target = this.cells[cell] ?? { x: this.cx, y: this.cy };
      const bend = (this.rand() - 0.5) * this.h * 0.9;
      const bee = this.newPatrolBee();
      Object.assign(bee, {
        state: 'wait', wait: i * 0.32, x: start[0], y: start[1], carry: 1, cell,
        p: [start, [lerp(start[0], target.x, 0.3), start[1] + bend], [lerp(start[0], target.x, 0.75), target.y - bend * 0.6], [target.x, target.y]],
        t: 0, dur: 2.3 + this.rand() * 1.1,
      });
      this.bees.push(bee);
    }
  }

  setThreat(open: number, high: number) { this.threat = { open: Math.max(0, open), high: Math.max(0, high) }; }
  /** A new alert: the shield flares and a wasp is drawn to the gate. */
  flare() { this.flareLevel = 1; }
  setPointer(x: number, y: number, active: boolean) { this.pointer = { x, y, active }; }

  private spark(x: number, y: number, n: number, color: string, speed = 40) {
    for (let i = 0; i < n; i++) {
      const a = this.rand() * TAU, s = speed * (0.4 + this.rand());
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, ttl: 0.5 + this.rand() * 0.6, size: 0.8 + this.rand() * 1.6, color });
    }
  }

  private pushTrail(tr: Trail[], x: number, y: number) {
    const last = tr[tr.length - 1];
    if (!last || Math.hypot(x - last.x, y - last.y) > 3) { tr.push({ x, y }); if (tr.length > 9) tr.shift(); }
  }

  update(dtRaw: number) {
    const dt = clamp(dtRaw, 0, 0.05);
    this.time += dt;
    this.queenFlap += dt * 13;

    for (const c of this.cells) c.glow = Math.max(0, c.glow - dt * 0.42);
    this.ambient -= dt;
    if (this.ambient <= 0 && this.cells.length) {
      this.ambient = 0.5 + this.rand() * 0.9;
      const c = this.cells[Math.floor(this.rand() * this.cells.length)] as Cell;
      c.glow = Math.max(c.glow, 0.3 + this.rand() * 0.2);
    }

    for (const b of this.bees) this.updateBee(b, dt);
    this.updateWasps(dt);

    this.flareLevel = Math.max(0, this.flareLevel - dt * 0.7);
    for (const h of this.hits) h.life -= dt * 2.2;
    this.hits = this.hits.filter((h) => h.life > 0);
    for (const s of this.sparks) { s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.96; s.vy *= 0.96; }
    this.sparks = this.sparks.filter((s) => s.life < s.ttl);
    for (const r of this.ripples) r.life += dt;
    this.ripples = this.ripples.filter((r) => r.life < r.ttl);
    for (const p of this.pollen) {
      p.x += (p.vx + Math.sin(this.time * 0.8 + p.phase) * 4) * dt; p.y += p.vy * dt;
      if (p.x > this.w + 4) p.x = -4; if (p.y < -4) p.y = this.h + 4;
    }
  }

  private updateBee(b: Bee, dt: number) {
    b.flap += dt * (b.state === 'arrive' ? 55 : 46);
    if (b.state === 'wait') {
      b.wait -= dt;
      if (b.wait <= 0) b.state = 'arrive';
      return;
    }
    if (b.state === 'arrive') {
      b.t += dt / b.dur;
      const t = clamp(b.t, 0, 1);
      const [p0, p1, p2, p3] = b.p as [[number, number], [number, number], [number, number], [number, number]];
      const e = t * t * (3 - 2 * t) * 0.6 + t * 0.4; // gentle ease, keeps momentum
      const ue = 1 - e;
      const nx = ue * ue * ue * p0[0] + 3 * ue * ue * e * p1[0] + 3 * ue * e * e * p2[0] + e * e * e * p3[0];
      const ny = ue * ue * ue * p0[1] + 3 * ue * ue * e * p1[1] + 3 * ue * e * e * p2[1] + e * e * e * p3[1];
      if (nx !== b.x || ny !== b.y) b.ang = Math.atan2(ny - b.y, nx - b.x);
      b.x = nx; b.y = ny;
      this.pushTrail(b.trail, b.x, b.y);
      if (b.t >= 1) {
        const c = this.cells[b.cell];
        if (c) { c.glow = 1; this.ripples.push({ x: c.x, y: c.y, r: 0, life: 0, ttl: 1.1, max: this.cell * 3.2 }); this.spark(c.x, c.y, 10, 'rgba(255,214,102,1)', 46); }
        b.state = 'patrol'; b.carry = 0; b.orbitA = Math.atan2(b.y - this.cy, b.x - this.cx); b.orbitR = Math.max(this.cell * 3.2, Math.hypot(b.x - this.cx, b.y - this.cy));
      }
      return;
    }
    // patrol: a spring follows a looping orbit around the hive, so the flight is smooth and never jittery
    b.orbitA += b.orbitW * dt;
    const r = b.orbitR * (1 + 0.16 * Math.sin(this.time * 0.7 + b.phase));
    let tx = this.cx + Math.cos(b.orbitA) * r + Math.cos(2 * b.orbitA + b.phase) * r * 0.22;
    let ty = this.cy + Math.sin(b.orbitA) * r * b.ratio + Math.sin(2 * b.orbitA + b.phase) * r * 0.18;
    if (b.curious && this.pointer.active && Math.hypot(this.pointer.x - b.x, this.pointer.y - b.y) < 220) {
      tx = this.pointer.x + Math.cos(this.time * 2.4 + b.phase) * 42; ty = this.pointer.y + Math.sin(this.time * 2.4 + b.phase) * 30;
    }
    const k = 8, damp = 2 * Math.sqrt(k) * 0.78;
    b.vx += ((tx - b.x) * k - b.vx * damp) * dt; b.vy += ((ty - b.y) * k - b.vy * damp) * dt;
    const sp = Math.hypot(b.vx, b.vy), max = 150;
    if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (sp > 6) b.ang += turn(b.ang, Math.atan2(b.vy, b.vx)) * 0.18;
    this.pushTrail(b.trail, b.x, b.y);
  }

  private wantedWasps() { return this.threat.open <= 0 ? 0 : clamp(Math.ceil(this.threat.open / 2), 1, MAX_WASPS); }

  private updateWasps(dt: number) {
    const want = this.wantedWasps();
    const alive = this.wasps.filter((w) => !w.leaving);
    if (alive.length < want) {
      const side = this.rand() < 0.5 ? -30 : this.w + 30;
      this.wasps.push({ x: side, y: this.rand() * this.h, vx: 0, vy: 0, ang: 0, flap: this.rand() * TAU, alpha: 0, tx: this.cx, ty: this.cy, hop: 0, leaving: false, cool: 0, trail: [] });
    } else if (alive.length > want) {
      (alive[alive.length - 1] as Wasp).leaving = true;
    }
    for (const w of this.wasps) {
      w.flap += dt * 60; w.cool -= dt;
      w.alpha = clamp(w.alpha + (w.leaving ? -dt * 1.2 : dt * 1.4), 0, 1);
      w.hop -= dt;
      if (w.hop <= 0) {
        w.hop = 0.7 + this.rand() * 1.1;
        const a = this.rand() * TAU, R = this.shieldR * (1.35 + this.rand() * 1.0);
        w.tx = clamp(this.cx + Math.cos(a) * R, 14, this.w - 14); w.ty = clamp(this.cy + Math.sin(a) * R * 0.8, 14, this.h - 14);
        if (this.rand() < 0.3) { w.tx = this.cx + Math.cos(a) * this.shieldR * 1.02; w.ty = this.cy + Math.sin(a) * this.shieldR * 1.02; } // a probing dart at the shield
      }
      const k = 5, damp = 2 * Math.sqrt(k) * 0.55;
      w.vx += ((w.tx - w.x) * k - w.vx * damp + (this.rand() - 0.5) * 240) * dt; w.vy += ((w.ty - w.y) * k - w.vy * damp + (this.rand() - 0.5) * 240) * dt;
      const dx = w.x - this.cx, dy = w.y - this.cy, d = Math.hypot(dx, dy) || 1;
      if (d < this.shieldR + 8) { // the Queen's shield repels
        w.vx += (dx / d) * 420 * dt * 6; w.vy += (dy / d) * 420 * dt * 6;
        if (w.cool <= 0) { w.cool = 0.45; this.hits.push({ angle: Math.atan2(dy, dx), life: 1 }); this.spark(this.cx + (dx / d) * this.shieldR, this.cy + (dy / d) * this.shieldR, 7, 'rgba(255,225,170,1)', 55); }
        const over = this.shieldR + 8 - d; if (over > 0) { w.x += (dx / d) * Math.min(over, 40 * dt * 6); w.y += (dy / d) * Math.min(over, 40 * dt * 6); }
      }
      const sp = Math.hypot(w.vx, w.vy), max = 190;
      if (sp > max) { w.vx *= max / sp; w.vy *= max / sp; }
      w.x += w.vx * dt; w.y += w.vy * dt;
      if (sp > 8) w.ang = Math.atan2(w.vy, w.vx);
      this.pushTrail(w.trail, w.x, w.y);
    }
    this.wasps = this.wasps.filter((w) => !(w.leaving && w.alpha <= 0));
  }

  draw(ctx: Ctx) {
    const { w, h } = this;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#190E27'); bg.addColorStop(1, '#33224A');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    // drifting lattice
    ctx.strokeStyle = 'rgba(232,163,23,0.06)'; ctx.lineWidth = 1; ctx.beginPath();
    const lr = 34, lw = Math.sqrt(3) * lr, ox = (this.time * 5) % lw;
    for (let row = -1; row * 1.5 * lr < h + lr; row++) for (let col = -1; col * lw < w + lw; col++) {
      const x = col * lw + (row % 2 ? lw / 2 : 0) - ox, y = row * 1.5 * lr;
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * TAU) / 6; const px = x + lr * Math.cos(a), py = y + lr * Math.sin(a); k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.lineTo(x + lr * Math.cos(Math.PI / 6), y + lr * Math.sin(Math.PI / 6));
    }
    ctx.stroke();

    // light shafts
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const a = 1.9 + i * 0.32 + Math.sin(this.time * 0.12 + i) * 0.07;
      const g = ctx.createLinearGradient(this.cx + 40, -30, this.cx + 40 + Math.cos(a) * h * 1.3, Math.sin(a) * h * 1.3);
      g.addColorStop(0, 'rgba(247,203,99,0.09)'); g.addColorStop(1, 'rgba(247,203,99,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(this.cx + 40, -30); ctx.lineTo(this.cx + 40 + Math.cos(a - 0.09) * h * 1.4, Math.sin(a - 0.09) * h * 1.4); ctx.lineTo(this.cx + 40 + Math.cos(a + 0.09) * h * 1.4, Math.sin(a + 0.09) * h * 1.4); ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // pollen
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const p of this.pollen) { ctx.fillStyle = `rgba(255,214,120,${0.25 + 0.3 * Math.abs(Math.sin(this.time * 1.3 + p.phase))})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill(); }
    ctx.restore();

    // hive glow
    const gl = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.shieldR * 1.9);
    gl.addColorStop(0, `rgba(232,163,23,${0.3 + 0.06 * Math.sin(this.time * 1.4)})`); gl.addColorStop(1, 'rgba(232,163,23,0)');
    ctx.fillStyle = gl; ctx.fillRect(0, 0, w, h);

    this.drawCells(ctx);
    this.drawShield(ctx);

    // queen
    const qp = 1 + 0.08 * Math.sin(this.time * 2.2);
    const qh = ctx.createRadialGradient(this.cx, this.cy, 2, this.cx, this.cy, this.cell * 2.6 * qp);
    qh.addColorStop(0, 'rgba(255,224,150,0.65)'); qh.addColorStop(1, 'rgba(255,224,150,0)');
    ctx.fillStyle = qh; ctx.beginPath(); ctx.arc(this.cx, this.cy, this.cell * 2.6 * qp, 0, TAU); ctx.fill();
    drawBee(ctx, this.cx, this.cy + Math.sin(this.time * 1.7) * 1.5, -Math.PI / 2 + Math.sin(this.time * 0.6) * 0.15, { scale: this.cell / 7.5, flap: this.queenFlap, crown: true, glow: 0.4 });

    for (const b of this.bees) this.drawTrail(ctx, b.trail, b.carry ? '255,214,102' : '247,203,99', b.carry ? 0.55 : 0.28);
    for (const wsp of this.wasps) this.drawTrail(ctx, wsp.trail, '255,90,74', 0.4 * wsp.alpha);
    for (const b of this.bees) if (b.state !== 'wait') drawBee(ctx, b.x, b.y, b.ang, { scale: 0.95 + (b.curious ? 0.1 : 0), flap: b.flap, carry: b.carry });
    for (const wsp of this.wasps) drawWasp(ctx, wsp.x, wsp.y, wsp.ang, { scale: 1.05, flap: wsp.flap, alpha: wsp.alpha });

    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const r of this.ripples) { const t = r.life / r.ttl; ctx.strokeStyle = `rgba(255,214,102,${0.7 * (1 - t)})`; ctx.lineWidth = 2 * (1 - t) + 0.5; ctx.beginPath(); ctx.arc(r.x, r.y, r.max * t, 0, TAU); ctx.stroke(); }
    for (const s of this.sparks) { const t = s.life / s.ttl; ctx.fillStyle = s.color.replace(/[\d.]+\)$/, `${1 - t})`); ctx.beginPath(); ctx.arc(s.x, s.y, s.size * (1 - t * 0.5), 0, TAU); ctx.fill(); }
    ctx.restore();

    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(10,5,18,0)'); vg.addColorStop(1, 'rgba(10,5,18,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  }

  private drawCells(ctx: Ctx) {
    const from = [58, 37, 82], to = [232, 163, 23];
    for (const [i, c] of this.cells.entries()) {
      const amb = 0.16 + 0.1 * Math.sin(this.time * 0.9 + c.phase);
      const t = clamp(amb + c.glow * 0.9, 0, 1);
      hexPath(ctx, c.x, c.y, this.cell * 0.93);
      ctx.fillStyle = i === 0 ? '#2B1D3A' : `rgb(${Math.round(lerp(from[0]!, to[0]!, t))},${Math.round(lerp(from[1]!, to[1]!, t))},${Math.round(lerp(from[2]!, to[2]!, t))})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(247,203,99,${0.3 + 0.55 * c.glow})`; ctx.lineWidth = 1.1; ctx.stroke();
      if (c.glow > 0.05) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, this.cell * 2);
        g.addColorStop(0, `rgba(255,214,102,${0.5 * c.glow})`); g.addColorStop(1, 'rgba(255,214,102,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, this.cell * 2, 0, TAU); ctx.fill(); ctx.restore();
      }
    }
  }

  private drawShield(ctx: Ctx) {
    const R = this.shieldR, threat = clamp(this.threat.high > 0 ? 1 : this.threat.open > 0 ? 0.45 : 0, 0, 1);
    const base = 0.14 + 0.08 * Math.sin(this.time * 2.2) + 0.55 * this.flareLevel;
    const col = (a: number) => `rgba(${Math.round(lerp(247, 255, threat))},${Math.round(lerp(203, 120, threat))},${Math.round(lerp(99, 90, threat))},${a})`;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const fill = ctx.createRadialGradient(this.cx, this.cy, R * 0.55, this.cx, this.cy, R);
    fill.addColorStop(0, 'rgba(247,203,99,0)'); fill.addColorStop(1, col(0.1 + 0.2 * this.flareLevel));
    ctx.fillStyle = fill; hexPath(ctx, this.cx, this.cy, R, this.time * 0.08); ctx.fill();
    ctx.strokeStyle = col(base); ctx.lineWidth = 1.6; hexPath(ctx, this.cx, this.cy, R, this.time * 0.08); ctx.stroke();
    ctx.setLineDash([5, 9]); ctx.strokeStyle = col(base * 0.7); hexPath(ctx, this.cx, this.cy, R * 1.06, -this.time * 0.12); ctx.stroke(); ctx.setLineDash([]);
    const beat = (this.time % 3.4) / 3.4;
    ctx.strokeStyle = col(0.28 * (1 - beat)); ctx.lineWidth = 1.2; hexPath(ctx, this.cx, this.cy, R * (0.9 + 0.4 * beat), this.time * 0.08); ctx.stroke();
    for (const hit of this.hits) { ctx.strokeStyle = `rgba(255,240,205,${hit.life})`; ctx.lineWidth = 3.2; ctx.beginPath(); ctx.arc(this.cx, this.cy, R, hit.angle - 0.4, hit.angle + 0.4); ctx.stroke(); }
    ctx.restore();
  }

  private drawTrail(ctx: Ctx, tr: Trail[], rgb: string, a: number) {
    if (tr.length < 2 || a <= 0) return;
    for (let i = 1; i < tr.length; i++) {
      const p = tr[i - 1] as Trail, q = tr[i] as Trail, t = i / tr.length;
      ctx.strokeStyle = `rgba(${rgb},${a * t})`; ctx.lineWidth = 0.6 + 1.6 * t; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
  }

  /** Run the simulation forward so a still frame (Calm mode) looks like a moment in a living scene. */
  warm(seconds = 2) { for (let t = 0; t < seconds; t += 1 / 60) this.update(1 / 60); }

  stats() {
    return { bees: this.bees.length, arriving: this.bees.filter((b) => b.state !== 'patrol').length, wasps: this.wasps.filter((w) => !w.leaving).length, cells: this.cells.length, litCells: this.cells.filter((c) => c.glow > 0.5).length };
  }
}
