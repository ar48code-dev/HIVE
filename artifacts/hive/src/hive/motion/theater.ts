import { C, TAU, drawBee, drawWasp, hexPath, type Ctx } from './draw.js';
import { rng, turn } from './sim.js';

/**
 * The attack sequence. One wasp per transaction streams toward the hive; when HIVE's alert fires (after `catchAt` transactions)
 * the Queen's shield bursts outward, the wasps still incoming are destroyed, and guard bees sweep out.
 * If `catchAt` is null the attack was NOT caught: the wasps reach the hive and nothing stops them. The animation never shows a catch that did not happen.
 */
interface W { x: number; y: number; sx: number; sy: number; c1: [number, number]; c2: [number, number]; delay: number; dur: number; ang: number; flap: number; state: 'wait' | 'fly' | 'dead' | 'swarm'; trail: Array<{ x: number; y: number }>; fall: number; orbit: number }
interface Guard { x: number; y: number; ang: number; a0: number; t: number; flap: number; trail: Array<{ x: number; y: number }> }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; ttl: number; size: number; rgb: string }

export type TheaterPhase = 'incoming' | 'caught' | 'missed';

export class TheaterSim {
  readonly w: number; readonly h: number; readonly n: number; readonly catchAt: number | null;
  readonly cx: number; readonly cy: number;
  t = 0; done = false; phase: TheaterPhase = 'incoming';
  wasps: W[] = []; guards: Guard[] = []; sparks: Spark[] = [];
  burstAt: number | null = null; duration: number;
  killed = 0; arrived = 0;
  private rand: () => number;
  private flap = 0;

  constructor(opts: { w: number; h: number; transactions: number; caughtAfter: number | null; seed?: number }) {
    this.rand = rng(opts.seed ?? 11);
    this.w = opts.w; this.h = opts.h; this.cx = opts.w / 2; this.cy = opts.h / 2;
    this.n = Math.max(1, Math.min(24, Math.round(opts.transactions)));
    // Map "caught after k of N transactions" onto the wasps we actually draw.
    this.catchAt = opts.caughtAfter === null ? null : Math.max(1, Math.min(this.n, Math.ceil((opts.caughtAfter / Math.max(1, opts.transactions)) * this.n)));
    const span = Math.min(2.6, 0.2 * this.n);
    for (let i = 0; i < this.n; i++) {
      const edge = Math.floor(this.rand() * 4);
      const sx = edge === 0 ? -30 : edge === 1 ? this.w + 30 : this.rand() * this.w, sy = edge === 2 ? -30 : edge === 3 ? this.h + 30 : this.rand() * this.h;
      const bend = (this.rand() - 0.5) * 260;
      this.wasps.push({
        x: sx, y: sy, sx, sy, c1: [sx + (this.cx - sx) * 0.35 + bend, sy + (this.cy - sy) * 0.2 - bend], c2: [sx + (this.cx - sx) * 0.7 - bend * 0.6, sy + (this.cy - sy) * 0.8 + bend * 0.5],
        delay: 0.4 + (i / Math.max(1, this.n - 1)) * span, dur: 1.5 + this.rand() * 0.5, ang: 0, flap: this.rand() * TAU, state: 'wait', trail: [], fall: 0, orbit: this.rand() * TAU,
      });
    }
    const last = this.wasps[this.wasps.length - 1] as W;
    if (this.catchAt === null) this.duration = last.delay + last.dur + 2.6;
    else {
      const trigger = this.wasps[this.catchAt - 1] as W;
      this.burstAt = trigger.delay + trigger.dur * 0.78;
      this.duration = Math.max(this.burstAt + 2.8, last.delay + 1.2);
    }
  }

  /** How far through the whole sequence we are (0-1). */
  get progress() { return Math.min(1, this.t / this.duration); }

  private spark(x: number, y: number, n: number, rgb: string, speed: number) {
    for (let i = 0; i < n; i++) { const a = this.rand() * TAU, s = speed * (0.3 + this.rand()); this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, ttl: 0.5 + this.rand() * 0.7, size: 1 + this.rand() * 2, rgb }); }
  }

  get ringRadius() { return this.burstAt === null || this.t < this.burstAt ? 0 : Math.min(Math.hypot(this.w, this.h) * 0.62, ((this.t - this.burstAt) / 0.95) ** 0.8 * Math.hypot(this.w, this.h) * 0.62); }

  update(dtRaw: number) {
    const dt = Math.min(0.05, Math.max(0, dtRaw));
    if (this.done) return;
    this.t += dt; this.flap += dt * 50;
    const ring = this.ringRadius;

    if (this.burstAt !== null && this.phase === 'incoming' && this.t >= this.burstAt) {
      this.phase = 'caught';
      for (let i = 0; i < 12; i++) this.guards.push({ x: this.cx, y: this.cy, ang: 0, a0: (i / 12) * TAU, t: 0, flap: this.rand() * TAU, trail: [] });
      this.spark(this.cx, this.cy, 40, '255,224,150', 160);
    }

    for (const w of this.wasps) {
      w.flap += dt * 60;
      if (w.state === 'wait' && this.t >= w.delay) w.state = 'fly';
      if (w.state === 'fly') {
        const u = Math.min(1, (this.t - w.delay) / w.dur), e = u * u * (3 - 2 * u) * 0.5 + u * 0.5, ue = 1 - e;
        const nx = ue ** 3 * w.sx + 3 * ue * ue * e * w.c1[0] + 3 * ue * e * e * w.c2[0] + e ** 3 * this.cx;
        const ny = ue ** 3 * w.sy + 3 * ue * ue * e * w.c1[1] + 3 * ue * e * e * w.c2[1] + e ** 3 * this.cy;
        const want = Math.atan2(ny - w.y, nx - w.x);
        w.ang += turn(w.ang, want) * 0.3; w.x = nx; w.y = ny;
        w.trail.push({ x: w.x, y: w.y }); if (w.trail.length > 12) w.trail.shift();
        const d = Math.hypot(w.x - this.cx, w.y - this.cy);
        if (this.phase === 'caught' && d < ring + 6) { w.state = 'dead'; this.killed++; this.spark(w.x, w.y, 14, '255,110,90', 110); }
        else if (u >= 1) {
          if (this.catchAt === null || this.phase === 'incoming') { w.state = 'swarm'; this.arrived++; this.spark(w.x, w.y, 5, '255,90,74', 40); }
          else { w.state = 'dead'; this.killed++; this.spark(w.x, w.y, 14, '255,110,90', 110); }
        }
      } else if (w.state === 'dead') {
        w.fall += dt; w.y += 70 * dt * w.fall; w.x += Math.sin(w.fall * 9) * 20 * dt; w.ang += 6 * dt;
      } else if (w.state === 'swarm') {
        w.orbit += dt * 3.2; const R = 44 + (w.delay * 17) % 40;
        const nx = this.cx + Math.cos(w.orbit) * R, ny = this.cy + Math.sin(w.orbit) * R * 0.7;
        w.ang = Math.atan2(ny - w.y, nx - w.x); w.x = nx; w.y = ny;
        if (this.phase === 'caught' && Math.hypot(w.x - this.cx, w.y - this.cy) < ring + 6) { w.state = 'dead'; this.killed++; this.spark(w.x, w.y, 14, '255,110,90', 110); }
      }
    }

    for (const g of this.guards) {
      g.t += dt; g.flap += dt * 55;
      const r = 30 + g.t * 230, a = g.a0 + g.t * 2.2;
      const nx = this.cx + Math.cos(a) * r, ny = this.cy + Math.sin(a) * r * 0.78;
      g.ang = Math.atan2(ny - g.y, nx - g.x); g.x = nx; g.y = ny;
      g.trail.push({ x: g.x, y: g.y }); if (g.trail.length > 10) g.trail.shift();
    }
    for (const s of this.sparks) { s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.95; s.vy *= 0.95; }
    this.sparks = this.sparks.filter((s) => s.life < s.ttl);

    if (this.catchAt === null && this.t > this.wasps[this.n - 1]!.delay + this.wasps[this.n - 1]!.dur + 0.5) this.phase = 'missed';
    if (this.t >= this.duration) this.done = true;
  }

  draw(ctx: Ctx) {
    const { w, h, cx, cy } = this;
    const fade = Math.min(1, this.t / 0.35) * Math.min(1, Math.max(0, (this.duration - this.t) / 0.6));
    ctx.save();
    ctx.fillStyle = `rgba(14,7,24,${0.62 * fade})`; ctx.fillRect(0, 0, w, h);
    const vg = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.7);
    vg.addColorStop(0, `rgba(232,163,23,${0.22 * fade})`); vg.addColorStop(1, 'rgba(232,163,23,0)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);

    // the hive gate
    ctx.globalAlpha = fade;
    const gate = 58;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const gg = ctx.createRadialGradient(cx, cy, 4, cx, cy, gate * 2.4);
    gg.addColorStop(0, 'rgba(255,214,102,0.55)'); gg.addColorStop(1, 'rgba(255,214,102,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(cx, cy, gate * 2.4, 0, TAU); ctx.fill(); ctx.restore();
    hexPath(ctx, cx, cy, gate, this.t * 0.1); ctx.fillStyle = 'rgba(43,29,58,0.92)'; ctx.fill();
    ctx.strokeStyle = this.phase === 'missed' ? 'rgba(255,90,74,0.9)' : 'rgba(247,203,99,0.9)'; ctx.lineWidth = 2.4; ctx.stroke();
    drawBee(ctx, cx, cy, -Math.PI / 2, { scale: 3.2, flap: this.flap * 0.25, crown: true, glow: 0.6 });

    // shield burst
    const ring = this.ringRadius;
    if (ring > 0) {
      const k = Math.min(1, (this.t - (this.burstAt ?? 0)) / 1.6);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const r = Math.max(0, ring - i * 22);
        ctx.strokeStyle = `rgba(${i === 0 ? '255,244,214' : '247,203,99'},${(0.9 - i * 0.3) * (1 - k * 0.7)})`; ctx.lineWidth = 5 - i * 1.4;
        hexPath(ctx, cx, cy, r, this.t * 0.4); ctx.stroke();
      }
      const rg = ctx.createRadialGradient(cx, cy, Math.max(0, ring - 70), cx, cy, ring + 4);
      rg.addColorStop(0, 'rgba(247,203,99,0)'); rg.addColorStop(1, `rgba(247,203,99,${0.3 * (1 - k)})`);
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, ring + 4, 0, TAU); ctx.fill();
      ctx.restore();
    }

    for (const wsp of this.wasps) {
      if (wsp.state === 'wait') continue;
      for (let i = 1; i < wsp.trail.length; i++) {
        const p = wsp.trail[i - 1]!, q = wsp.trail[i]!, t = i / wsp.trail.length;
        ctx.strokeStyle = `rgba(255,90,74,${0.5 * t * (wsp.state === 'dead' ? 0.3 : 1)})`; ctx.lineWidth = 0.8 + 2 * t; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      drawWasp(ctx, wsp.x, wsp.y, wsp.ang, { scale: 1.35, flap: wsp.flap, alpha: wsp.state === 'dead' ? Math.max(0, 1 - wsp.fall * 1.3) : 1 });
    }
    for (const g of this.guards) {
      for (let i = 1; i < g.trail.length; i++) { const p = g.trail[i - 1]!, q = g.trail[i]!, t = i / g.trail.length; ctx.strokeStyle = `rgba(255,224,150,${0.55 * t})`; ctx.lineWidth = 0.8 + 2.2 * t; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
      drawBee(ctx, g.x, g.y, g.ang, { scale: 1.3, flap: g.flap, glow: 0.7 });
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) { const t = s.life / s.ttl; ctx.fillStyle = `rgba(${s.rgb},${1 - t})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.size * (1 - t * 0.5), 0, TAU); ctx.fill(); }
    ctx.restore();
    void C;
  }
}
