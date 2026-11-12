import type { Cell } from './features.js';

export interface BeeInfo { kind: 'bee'; label: string; sub: string }
export interface WaspInfo { kind: 'wasp'; label: string; sub: string; alertId: number }
export type Info = BeeInfo | WaspInfo;

export interface Agent { x: number; y: number; vx: number; vy: number; tx: number; ty: number; wait: number; phase: number; size: number; info: Info; hue: 'honey' | 'pale' | 'grey' | 'wasp'; carry: boolean; fast: number; linger?: boolean }
export interface PatrolBee extends Agent { orbitAngle: number; orbitSpeed: number; radiusX: number; radiusY: number }

export interface SwarmInput {
  bees: Array<{ id: string; kind: 'payment' | 'refund' | 'failed'; amountCents: number; label: string; sub: string }>;
  wasps: Array<{ alertId: number; severity: 'low' | 'medium' | 'high'; label: string; sub: string }>;
}

export const PATROL_BEE_COUNT = 18;

/** Logical space is the same as the hive's SVG space, centred on the Queen. */
export class Swarm {
  agents: Agent[] = [];
  readonly patrolBees: PatrolBee[];
  private seen = new Set<string>();
  constructor(private cells: Cell[]) {
    this.patrolBees = Array.from({ length: PATROL_BEE_COUNT }, (_, i) => {
      const orbitAngle = (i / PATROL_BEE_COUNT) * Math.PI * 2;
      const radiusX = 286 + (i % 3) * 7;
      const radiusY = 228 + (i % 4) * 7;
      const x = Math.cos(orbitAngle) * radiusX;
      const y = Math.sin(orbitAngle) * radiusY;
      return {
        x, y, vx: 0, vy: 0, tx: x, ty: y, wait: 0, phase: i * 2.4, size: 2.6,
        info: { kind: 'bee', label: 'Worker bee', sub: 'Decorative patrol; not a transaction' },
        hue: 'honey', carry: false, fast: 1, orbitAngle,
        orbitSpeed: (i % 2 === 0 ? 1 : -1) * (0.16 + (i % 4) * 0.035), radiusX, radiusY,
      };
    });
  }

  private pick(): Cell { return this.cells[Math.floor(Math.random() * this.cells.length)] ?? this.cells[0]!; }

  private spawn(i: SwarmInput['bees'][number], fromEdge: boolean): Agent {
    const c = this.pick();
    const a = Math.random() * Math.PI * 2;
    const x = fromEdge ? Math.cos(a) * 330 : c.x + (Math.random() - 0.5) * 40, y = fromEdge ? Math.sin(a) * 300 : c.y + (Math.random() - 0.5) * 40;
    const size = 3.2 + Math.min(3.2, Math.log10(Math.max(10, i.amountCents)) - 1);
    return { x, y, vx: 0, vy: 0, tx: fromEdge ? 0 : c.x, ty: fromEdge ? 0 : c.y, wait: 0, phase: Math.random() * 6, size, carry: i.kind === 'payment', fast: 1,
      hue: i.kind === 'payment' ? 'honey' : i.kind === 'refund' ? 'pale' : 'grey', info: { kind: 'bee', label: i.label, sub: i.sub } };
  }

  /** Sync agents with the latest data. New payments fly in from outside and go straight to the Queen. */
  sync(input: SwarmInput, animateNew: boolean) {
    const keep = new Set<string>();
    for (const b of input.bees) {
      const key = `b${b.id}`; keep.add(key);
      if (!this.seen.has(key)) { this.seen.add(key); const ag = this.spawn(b, animateNew); (ag as Agent & { key?: string }).key = key; this.agents.push(ag); }
    }
    for (const w of input.wasps) {
      const key = `w${w.alertId}`; keep.add(key);
      if (!this.seen.has(key)) {
        this.seen.add(key);
        const a = Math.random() * Math.PI * 2, R = 300;
        const ag: Agent = { x: Math.cos(a) * R, y: Math.sin(a) * R * 0.9, vx: 0, vy: 0, tx: 0, ty: 0, wait: 0, phase: a, size: w.severity === 'high' ? 6 : w.severity === 'medium' ? 5 : 4, carry: false, hue: 'wasp',
          fast: w.severity === 'high' ? 1.5 : w.severity === 'medium' ? 1.15 : 0.9, info: { kind: 'wasp', label: w.label, sub: w.sub, alertId: w.alertId } };
        (ag as Agent & { key?: string }).key = key; this.agents.push(ag);
      }
    }
    this.agents = this.agents.filter((a) => keep.has((a as Agent & { key?: string }).key ?? ''));
  }

  warm(seconds: number) { for (let i = 0; i < seconds * 30; i++) this.update(1 / 30); }

  update(dt: number) {
    for (const bee of this.patrolBees) {
      const oldX = bee.x, oldY = bee.y;
      bee.orbitAngle += bee.orbitSpeed * dt;
      bee.phase += dt * 18;
      bee.x = Math.cos(bee.orbitAngle) * bee.radiusX;
      bee.y = Math.sin(bee.orbitAngle) * bee.radiusY;
      const invDt = dt > 0 ? 1 / dt : 0;
      bee.vx = (bee.x - oldX) * invDt;
      bee.vy = (bee.y - oldY) * invDt;
    }

    for (const a of this.agents) {
      a.phase += dt * 18;
      if (a.hue === 'wasp') {
        // Wasps circle the outside, then dive at the shield and are bounced back. They never get inside.
        a.wait -= dt;
        if (a.wait <= 0) { const ang = Math.random() * Math.PI * 2; const dive = Math.random() < 0.45; const R = dive ? 175 : 290; a.tx = Math.cos(ang) * R; a.ty = Math.sin(ang) * R * 0.92; a.wait = 1.2 + Math.random() * 1.8; }
      } else {
        const d = Math.hypot(a.tx - a.x, a.ty - a.y);
        if (a.linger) {
          a.wait -= dt;
          if (a.wait <= 0) { const c = Math.random() < 0.28 ? this.cells[0]! : this.pick(); a.tx = c.x + (Math.random() - 0.5) * 36; a.ty = c.y + (Math.random() - 0.5) * 36; a.linger = false; }
        } else if (d < 14) {
          a.linger = true; a.wait = 0.4 + Math.random() * 1.6;
          if (Math.hypot(a.tx, a.ty) < 40) a.carry = false; // delivered the honey to the Queen
        }
      }
      const dx = a.tx - a.x, dy = a.ty - a.y, dist = Math.hypot(dx, dy) || 1;
      const sp = (a.hue === 'wasp' ? 95 : 70) * a.fast;
      const wob = a.hue === 'wasp' ? 70 : 38;
      a.vx += ((dx / dist) * sp + Math.cos(a.phase * 0.31) * wob - a.vx) * Math.min(1, dt * 2.4);
      a.vy += ((dy / dist) * sp + Math.sin(a.phase * 0.27) * wob - a.vy) * Math.min(1, dt * 2.4);
      a.x += a.vx * dt; a.y += a.vy * dt;
      if (a.hue === 'wasp') { // the shield: a soft wall at radius ~160 only for wasps that were told to dive
        const r = Math.hypot(a.x, a.y); if (r < 150) { a.x *= 150 / r; a.y *= 150 / r; a.vx *= -0.8; a.vy *= -0.8; a.wait = 0; }
      }
    }
  }

  /** Find the nearest agent to a point in logical space. */
  nearest(x: number, y: number, within = 16): Agent | null {
    let best: Agent | null = null, bd = within;
    for (const a of this.agents) { const d = Math.hypot(a.x - x, a.y - y); if (d < bd) { bd = d; best = a; } }
    return best;
  }

  draw(ctx: CanvasRenderingContext2D, flare: number) {
    // Shield ring
    ctx.save();
    const waspNear = this.agents.some((a) => a.hue === 'wasp' && Math.hypot(a.x, a.y) < 200);
    ctx.lineWidth = 2; ctx.strokeStyle = waspNear || flare > 0 ? `rgba(255,120,100,${0.35 + flare * 0.5})` : 'rgba(255,214,102,0.10)';
    ctx.setLineDash([6, 10]); ctx.beginPath(); ctx.ellipse(0, 0, 172, 160, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    for (const a of this.agents) {
      const ang = Math.atan2(a.vy, a.vx);
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(ang);
      const flap = 0.35 + Math.abs(Math.sin(a.phase)) * 0.55;
      const s = a.size;
      const body = a.hue === 'wasp' ? '#ff5a45' : a.hue === 'honey' ? '#ffc933' : a.hue === 'pale' ? '#9fd4ff' : '#9aa0ad';
      ctx.fillStyle = `rgba(235,240,255,${flap * 0.55})`;
      ctx.beginPath(); ctx.ellipse(-s * 0.1, -s * 1.1, s * 1.1, s * 0.55, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-s * 0.1, s * 1.1, s * 1.1, s * 0.55, -0.5, 0, Math.PI * 2); ctx.fill();
      if (a.hue === 'wasp') { ctx.shadowColor = '#ff3b2a'; ctx.shadowBlur = 12; }
      else if (a.hue === 'honey') { ctx.shadowColor = '#ffc933'; ctx.shadowBlur = 8; }
      ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 0, s * 1.5, s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = '#1a1024';
      ctx.fillRect(-s * 0.2, -s * 0.9, s * 0.45, s * 1.8); if (a.hue === 'wasp') ctx.fillRect(-s * 0.95, -s * 0.8, s * 0.4, s * 1.6);
      if (a.hue === 'wasp') { ctx.beginPath(); ctx.moveTo(-s * 1.5, 0); ctx.lineTo(-s * 2.2, 0); ctx.strokeStyle = '#1a1024'; ctx.lineWidth = 1.6; ctx.stroke(); }
      if (a.carry) { ctx.fillStyle = '#fff2b0'; ctx.beginPath(); ctx.arc(-s * 0.2, s * 1.0, s * 0.45, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  }
}
