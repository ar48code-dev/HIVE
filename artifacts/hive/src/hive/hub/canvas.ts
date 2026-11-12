import { C, TAU, drawBee, drawWasp, hexPath } from '../motion/draw.js';
import { HEX, type Cell } from './features.js';
import { Swarm, type Agent, type Info } from './swarm.js';

const VB_W = 600, VB_H = 560;
export interface Callbacks { hover: (c: Cell | null) => void; tip: (t: { x: number; y: number; info: Info } | null) => void; wasp: (alertId: number) => void; open: (c: Cell) => void; label: (p: { x: number; y: number } | null) => void }
const smooth = (t: number) => t * t * (3 - 2 * t);

interface Worker { t: number; fx: number; fy: number; cx: number; cy: number; tx: number; ty: number; cell: number; phase: 'fly' | 'lid'; wait: number; x: number; y: number; ang: number }

/** The hub, drawn with the same bees, wasps, night sky and glowing comb as the hero scene. Depth comes from raised cell edges and layered parallax that follows the pointer. */
export class HubCanvas {
  cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w = 0; h = 0; k = 1; cx = 0; cy = 0; dpr = 1;
  swarm: Swarm; time = 0; full = true; flare = 0; busy = false;
  px = 0; py = 0; tpx = 0; tpy = 0; mouse: { x: number; y: number } | null = null;
  hov: number[]; open: number[]; hovered = -1; worker: Worker | null = null;
  stars = Array.from({ length: 110 }, (_, i) => ({ x: ((i * 9301 + 49297) % 233280) / 233280, y: ((i * 7919 + 12345) % 104729) / 104729, r: 0.4 + (i % 5) * 0.25, p: i }));
  pollen = Array.from({ length: 36 }, (_, i) => ({ x: ((i * 4129 + 77) % 1000) / 1000, y: ((i * 6151 + 301) % 1000) / 1000, s: 0.8 + (i % 4) * 0.5, p: i * 1.7 }));

  constructor(private host: HTMLElement, private cells: Cell[], private cb: Callbacks) {
    this.cv = document.createElement('canvas'); this.cv.className = 'hub-gl'; host.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d')!; this.swarm = new Swarm(cells);
    this.hov = cells.map(() => 0); this.open = cells.map(() => 0);
    this.resize();
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2); this.w = w; this.h = h;
    this.cv.width = Math.round(w * this.dpr); this.cv.height = Math.round(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.k = Math.min(w / VB_W, h / VB_H) * 0.97; this.cx = w / 2; this.cy = h / 2;
    if (!this.full) this.render(0);
  }

  // ---- geometry -------------------------------------------------------------------
  private sx(x: number, depth: number) { return this.cx + x * this.k + this.px * depth * this.k; }
  private sy(y: number, depth: number) { return this.cy + y * this.k + this.py * depth * this.k; }
  private cellAt(mx: number, my: number): number {
    let best = -1, bd = Infinity;
    this.cells.forEach((c, i) => {
      const x = this.sx(c.x, 9), y = this.sy(c.y, 9) - this.hov[i]! * 8 * this.k;
      const dx = Math.abs(mx - x), dy = Math.abs(my - y), r = (HEX - 3) * this.k;
      // pointy-top hexagon test
      if (dy <= r && dx <= r * 0.866 && dx * 0.5 + dy * 0.866 <= r * 0.866 + 0.001 * r) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    });
    return best;
  }
  private agentAt(): Agent | null {
    if (!this.mouse) return null; let best: Agent | null = null, bd = 20;
    for (const a of this.swarm.agents) { const d = Math.hypot(this.sx(a.x, 16) - this.mouse.x, this.sy(a.y, 16) - this.mouse.y); if (d < bd) { bd = d; best = a; } }
    return best;
  }

  // ---- input ----------------------------------------------------------------------
  setPointer(e: { clientX: number; clientY: number } | null) {
    if (!e) { this.mouse = null; this.tpx = 0; this.tpy = 0; return; }
    const r = this.host.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    this.mouse = { x, y }; this.tpx = (x / r.width - 0.5) * 2; this.tpy = (y / r.height - 0.5) * 2;
  }
  hoverAt(): Cell | null {
    const a = this.agentAt();
    if (a && this.mouse) this.cb.tip({ x: this.mouse.x, y: this.mouse.y, info: a.info }); else this.cb.tip(null);
    const i = this.mouse ? this.cellAt(this.mouse.x, this.mouse.y) : -1;
    if (i !== this.hovered) { this.hovered = i; this.cb.hover(i >= 0 ? this.cells[i]! : null); }
    this.host.style.cursor = i >= 0 || (a && a.info.kind === 'wasp') ? 'pointer' : 'default';
    if (!this.full) this.render(0);
    return i >= 0 ? this.cells[i]! : null;
  }
  hoverCell(c: Cell | null) { this.hovered = c ? this.cells.findIndex((x) => x.id === c.id) : -1; this.cb.hover(c); if (!this.full) this.render(0); }
  click() {
    const a = this.agentAt(); if (a && a.info.kind === 'wasp') { this.cb.wasp(a.info.alertId); return; }
    const i = this.mouse ? this.cellAt(this.mouse.x, this.mouse.y) : -1; if (i >= 0) this.activate(this.cells[i]!);
  }

  /** A worker bee leaves the swarm, flies to the cell, lands, and the cell opens like a lid. Then the page opens. */
  activate(cell: Cell) {
    if (this.busy) return; const i = this.cells.findIndex((c) => c.id === cell.id); if (i < 0) return;
    if (!this.full) { this.cb.open(cell); return; }
    this.busy = true;
    const src = this.swarm.agents.find((a) => a.info.kind === 'bee');
    const fx = src ? src.x : (Math.random() < 0.5 ? -330 : 330), fy = src ? src.y : -250;
    const c = this.cells[i]!;
    this.worker = { t: 0, fx, fy, cx: (fx + c.x) / 2 + (Math.random() - 0.5) * 140, cy: Math.min(fy, c.y) - 110, tx: c.x, ty: c.y, cell: i, phase: 'fly', wait: 0, x: fx, y: fy, ang: 0 };
  }

  // ---- simulation -----------------------------------------------------------------
  private step(dt: number) {
    this.time += dt;
    const f = Math.min(1, dt * 4); this.px += (this.tpx - this.px) * f; this.py += (this.tpy - this.py) * f;
    this.swarm.update(dt); this.flare = Math.max(0, this.flare - dt * 0.8);
    this.cells.forEach((_, i) => { const t = this.hovered === i || this.worker?.cell === i ? 1 : 0; this.hov[i]! += (t - this.hov[i]!) * Math.min(1, dt * 9); });
    const w = this.worker; if (!w) return;
    if (w.phase === 'fly') {
      w.t = Math.min(1, w.t + dt / 0.9); const e = smooth(w.t), k = 1 - e;
      const nx = k * k * w.fx + 2 * k * e * w.cx + e * e * w.tx, ny = k * k * w.fy + 2 * k * e * w.cy + e * e * w.ty;
      if (Math.hypot(nx - w.x, ny - w.y) > 0.2) w.ang = Math.atan2(ny - w.y, nx - w.x);
      w.x = nx; w.y = ny;
      if (w.t >= 1) w.phase = 'lid';
    } else {
      w.wait += dt; this.open[w.cell] = Math.min(1, w.wait / 0.4);
      if (w.wait > 0.75) { const c = this.cells[w.cell]!; this.worker = null; this.busy = false; this.open[w.cell] = 0; this.cb.open(c); }
    }
  }

  // ---- drawing --------------------------------------------------------------------
  private background() {
    const { ctx, w, h, time } = this;
    const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#190E27'); bg.addColorStop(1, '#33224A'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    for (const s of this.stars) { ctx.fillStyle = `rgba(255,236,200,${0.25 + 0.45 * Math.abs(Math.sin(time * 0.8 + s.p))})`; ctx.beginPath(); ctx.arc(s.x * w - this.px * 4, s.y * h - this.py * 4, s.r, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = 'rgba(232,163,23,0.06)'; ctx.lineWidth = 1; ctx.beginPath();
    const lr = 38, lw = Math.sqrt(3) * lr, ox = (time * 5) % lw - this.px * 6;
    for (let row = -1; row * 1.5 * lr < h + lr; row++) for (let col = -1; col * lw < w + lw; col++) {
      const x = col * lw + (row % 2 ? lw / 2 : 0) - ox, y = row * 1.5 * lr - this.py * 6;
      for (let q = 0; q < 6; q++) { const a = Math.PI / 6 + (q * TAU) / 6; const px = x + lr * Math.cos(a), py = y + lr * Math.sin(a); q === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.lineTo(x + lr * Math.cos(Math.PI / 6), y + lr * Math.sin(Math.PI / 6));
    }
    ctx.stroke();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) { const a = 1.9 + i * 0.32 + Math.sin(time * 0.12 + i) * 0.07, ox2 = this.cx + 40; const g = ctx.createLinearGradient(ox2, -30, ox2 + Math.cos(a) * h * 1.3, Math.sin(a) * h * 1.3); g.addColorStop(0, 'rgba(247,203,99,0.08)'); g.addColorStop(1, 'rgba(247,203,99,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(ox2, -30); ctx.lineTo(ox2 + Math.cos(a - 0.09) * h * 1.4, Math.sin(a - 0.09) * h * 1.4); ctx.lineTo(ox2 + Math.cos(a + 0.09) * h * 1.4, Math.sin(a + 0.09) * h * 1.4); ctx.closePath(); ctx.fill(); }
    for (const p of this.pollen) { ctx.fillStyle = `rgba(255,214,120,${0.2 + 0.3 * Math.abs(Math.sin(time * 1.3 + p.p))})`; ctx.beginPath(); ctx.arc(((p.x * w + time * 6 * p.s) % w) - this.px * 12, ((p.y * h - time * 4 * p.s) % h + h) % h - this.py * 12, p.s, 0, TAU); ctx.fill(); }
    const gl = ctx.createRadialGradient(this.sx(0, 5), this.sy(0, 5), 0, this.sx(0, 5), this.sy(0, 5), 330 * this.k); gl.addColorStop(0, `rgba(232,163,23,${0.3 + 0.06 * Math.sin(time * 1.4)})`); gl.addColorStop(1, 'rgba(232,163,23,0)'); ctx.fillStyle = gl; ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  private drawCell(i: number) {
    const { ctx, k } = this; const c = this.cells[i]!, hv = this.hov[i]!, op = this.open[i]!;
    const x = this.sx(c.x, 9), r = (HEX - 3) * k, lift = hv * 8 * k, y = this.sy(c.y, 9) - lift;
    // raised edge (the cell has thickness)
    for (const [dy, col] of [[7, '#0d0716'], [4, '#1c1030']] as const) { hexPath(ctx, x, y + dy * k + lift * 0.4, r * (1 + 0.03 * hv)); ctx.fillStyle = col; ctx.fill(); }
    if (hv > 0.02 || c.center) { ctx.save(); ctx.shadowColor = `rgba(255,201,51,${0.25 + 0.55 * hv})`; ctx.shadowBlur = (10 + 26 * hv) * k; hexPath(ctx, x, y, r * (1 + 0.05 * hv)); ctx.fillStyle = '#2b1d3a'; ctx.fill(); ctx.restore(); }
    if (op > 0) { const g = ctx.createRadialGradient(x, y, 2, x, y, r); g.addColorStop(0, 'rgba(255,240,190,1)'); g.addColorStop(1, 'rgba(247,170,30,0.9)'); hexPath(ctx, x, y, r); ctx.fillStyle = g; ctx.fill(); }
    ctx.save();
    if (op > 0) { ctx.translate(x, y - r); ctx.scale(1, Math.max(0.04, 1 - op * 0.96)); ctx.translate(-x, -(y - r)); }
    const g = ctx.createLinearGradient(x, y - r, x, y + r);
    if (c.center) { g.addColorStop(0, 'rgba(120,84,30,0.92)'); g.addColorStop(1, 'rgba(70,44,20,0.92)'); }
    else { g.addColorStop(0, `rgba(${86 + 120 * hv | 0},${62 + 80 * hv | 0},${120 - 50 * hv | 0},0.9)`); g.addColorStop(1, `rgba(${42 + 110 * hv | 0},${28 + 70 * hv | 0},${62 - 20 * hv | 0},0.92)`); }
    hexPath(ctx, x, y, r * (1 + 0.05 * hv)); ctx.fillStyle = g; ctx.fill();
    // glass sheen
    const sh = ctx.createLinearGradient(x - r, y - r, x + r * 0.3, y + r * 0.3); sh.addColorStop(0, 'rgba(255,255,255,0.16)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    hexPath(ctx, x, y, r * 0.86 * (1 + 0.05 * hv)); ctx.fillStyle = sh; ctx.fill();
    ctx.lineWidth = (1.3 + 1.2 * hv) * k; ctx.strokeStyle = hv > 0.3 || c.center ? C.honeyLight : 'rgba(232,163,23,0.55)';
    hexPath(ctx, x, y, r * (1 + 0.05 * hv)); ctx.stroke();
    ctx.restore();
  }

  private draw() {
    const { ctx, k, time } = this;
    this.background();
    // shield
    const near = this.swarm.agents.some((a) => a.hue === 'wasp' && Math.hypot(a.x, a.y) < 205);
    const sr = 178 * k, scx = this.sx(0, 9), scy = this.sy(0, 9);
    ctx.save(); ctx.lineWidth = 2.2 * k; ctx.lineCap = 'round';
    for (let q = 0; q < 6; q++) { const a0 = time * 0.18 + q * (TAU / 6); ctx.strokeStyle = near || this.flare > 0 ? `rgba(255,110,90,${0.4 + 0.5 * this.flare})` : 'rgba(247,203,99,0.22)'; ctx.beginPath(); ctx.arc(scx, scy, sr, a0, a0 + 0.62); ctx.stroke(); }
    ctx.restore();
    // cells: far to near so a lifted cell overlaps its neighbours
    const order = this.cells.map((_, i) => i).sort((a, b) => this.cells[a]!.y - this.cells[b]!.y || this.hov[a]! - this.hov[b]!);
    for (const i of order) if (!this.cells[i]!.center) this.drawCell(i);
    this.drawCell(0);
    // queen
    const qc = this.cells[0]!, qh = 1 + 0.1 * this.hov[0]!, qx = this.sx(0, 14), qy = this.sy(0, 14) - this.hov[0]! * 8 * k;
    const pulse = 1 + 0.08 * Math.sin(time * 2.2); const rg = ctx.createRadialGradient(qx, qy, 2, qx, qy, 70 * k * pulse);
    rg.addColorStop(0, 'rgba(255,224,150,0.6)'); rg.addColorStop(1, 'rgba(255,224,150,0)'); ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(qx, qy, 70 * k * pulse, 0, TAU); ctx.fill();
    drawBee(ctx, qx, qy + Math.sin(time * 1.7) * 1.5 * k, -Math.PI / 2 + Math.sin(time * 0.6) * 0.15, { scale: 4.1 * k * qh, flap: time * 22, crown: true, glow: 0.4 });
    void qc;
    // Eighteen ambient worker bees keep the hive alive without implying payments.
    for (const a of this.swarm.patrolBees) {
      const x = this.sx(a.x, 16), y = this.sy(a.y, 16);
      ctx.save(); ctx.globalAlpha = 0.9;
      drawBee(ctx, x, y, Math.atan2(a.vy, a.vx), { scale: 0.82 * Math.max(0.8, k * 1.15), flap: a.phase * 2.4 });
      ctx.restore();
    }
    // swarm
    for (const a of this.swarm.agents) {
      const x = this.sx(a.x, 16), y = this.sy(a.y, 16), ang = Math.atan2(a.vy, a.vx);
      if (a.hue === 'wasp') { drawWasp(ctx, x, y, ang, { scale: (0.9 + a.size * 0.06) * Math.max(0.8, k * 1.15), flap: a.phase * 2.4 }); continue; }
      const s = (0.85 + (a.size - 3) * 0.09) * Math.max(0.8, k * 1.15);
      ctx.save(); if (a.hue === 'pale') ctx.filter = 'hue-rotate(165deg) saturate(1.1)'; else if (a.hue === 'grey') { ctx.filter = 'grayscale(1)'; ctx.globalAlpha = 0.75; }
      drawBee(ctx, x, y, ang, { scale: s, flap: a.phase * 2.4, carry: a.carry ? 0.7 : 0 }); ctx.restore();
    }
    // worker bee
    const w = this.worker;
    if (w) {
      const x = this.sx(w.x, 16), y = this.sy(w.y, 16);
      const sc = 1.7 * Math.max(0.8, k * 1.15) * (w.phase === 'lid' ? 1 + 0.06 * Math.sin(w.wait * 30) : 1);
      drawBee(ctx, x, y, w.phase === 'lid' ? -Math.PI / 2 : w.ang, { scale: sc, flap: time * 40, glow: 0.9, carry: 0.6 });
    }
    const vg = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.4, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    vg.addColorStop(0, 'rgba(10,5,18,0)'); vg.addColorStop(1, 'rgba(10,5,18,0.55)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, this.w, this.h);
    // label above the hovered cell
    if (this.hovered >= 0) { const c = this.cells[this.hovered]!; this.cb.label({ x: this.sx(c.x, 9), y: this.sy(c.y, 9) - (HEX + 2) * k - this.hov[this.hovered]! * 8 * k }); } else this.cb.label(null);
  }

  render(dt: number) { this.step(dt > 0 ? dt : 0.0001); this.draw(); }
  dispose() { this.cv.remove(); }
}
