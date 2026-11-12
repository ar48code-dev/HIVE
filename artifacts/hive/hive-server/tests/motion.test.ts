import { describe, expect, it } from 'vitest';
import { HiveSim, MAX_BEES, MAX_WASPS } from '../../src/hive/motion/sim.js';
import { TheaterSim } from '../../src/hive/motion/theater.js';
import { drawBee, drawWasp, type Ctx } from '../../src/hive/motion/draw.js';

/** A canvas stand-in that records nothing and accepts every call, so drawing code can run in Node. */
const stubCtx = (): Ctx => {
  const grad = { addColorStop: () => undefined };
  return new Proxy({}, {
    get: (_t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => grad : () => undefined),
    set: () => true,
  }) as unknown as Ctx;
};
const run = (sim: { update(dt: number): void }, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 60) sim.update(1 / 60); };
const finite = (n: number) => Number.isFinite(n);

describe('hive scene', () => {
  it('builds a 37-cell hive and a sensible number of bees', () => {
    const s = new HiveSim(); s.resize(1100, 300);
    expect(s.cells).toHaveLength(37);
    expect(s.bees.length).toBeGreaterThanOrEqual(8);
    expect(s.bees.length).toBeLessThanOrEqual(16);
    expect(s.cells[0]).toMatchObject({ ring: 0 }); // the queen's cell is first
  });
  it('is reproducible for a seed and never produces NaN', () => {
    const a = new HiveSim(3), b = new HiveSim(3); a.resize(900, 280); b.resize(900, 280); a.setThreat(4, 1); b.setThreat(4, 1);
    run(a, 12); run(b, 12);
    expect(a.bees.map((x) => Math.round(x.x))).toEqual(b.bees.map((x) => Math.round(x.x)));
    expect([...a.bees, ...a.wasps].every((x) => finite(x.x) && finite(x.y) && finite(x.ang))).toBe(true);
  });
  it('a payment sends honey-carrying bees in, and they light a cell when they arrive', () => {
    const s = new HiveSim(); s.resize(1100, 300); const before = s.bees.length;
    s.arrive(3);
    expect(s.bees.length).toBe(before + 3);
    expect(s.stats().arriving).toBe(3);
    let lit = 0; for (let t = 0; t < 7; t += 1 / 60) { s.update(1 / 60); lit = Math.max(lit, s.cells.filter((c) => c.glow > 0.9).length); }
    expect(lit).toBeGreaterThanOrEqual(1);
    expect(s.stats().arriving).toBe(0); // all became patrol bees again
    expect(s.bees.every((b) => b.carry === 0)).toBe(true);
  });
  it('never grows without bound however many payments arrive', () => {
    const s = new HiveSim(); s.resize(1100, 300);
    for (let i = 0; i < 60; i++) { s.arrive(8); run(s, 0.2); }
    expect(s.bees.length).toBeLessThanOrEqual(MAX_BEES);
    expect(s.sparks.length).toBeLessThan(2000);
  });
  it('shows wasps for open alerts, capped, and keeps them outside the queen\'s shield', () => {
    const s = new HiveSim(); s.resize(1100, 300); s.setThreat(40, 3);
    run(s, 2);
    expect(s.stats().wasps).toBeLessThanOrEqual(MAX_WASPS);
    expect(s.stats().wasps).toBeGreaterThan(0);
    let deepest = Infinity;
    for (let t = 0; t < 20; t += 1 / 60) { s.update(1 / 60); for (const w of s.wasps) if (w.alpha > 0.5) deepest = Math.min(deepest, Math.hypot(w.x - s.cx, w.y - s.cy)); }
    expect(deepest).toBeGreaterThan(s.shieldR - 14);
  });
  it('wasps leave when the alerts are cleared', () => {
    const s = new HiveSim(); s.resize(1100, 300); s.setThreat(3, 0); run(s, 3);
    expect(s.wasps.length).toBeGreaterThan(0);
    s.setThreat(0, 0); run(s, 4);
    expect(s.wasps).toHaveLength(0);
  });
  it('flaring the shield decays back to calm', () => {
    const s = new HiveSim(); s.resize(900, 280); s.flare(); expect(s.flareLevel).toBe(1); run(s, 2); expect(s.flareLevel).toBe(0);
  });
  it('draws without throwing, including a calm still frame and a tiny canvas', () => {
    const s = new HiveSim(); s.resize(1100, 300); s.setThreat(3, 1); s.arrive(2); s.warm(2); expect(() => s.draw(stubCtx())).not.toThrow();
    const tiny = new HiveSim(); tiny.resize(320, 180); run(tiny, 1); expect(() => tiny.draw(stubCtx())).not.toThrow();
    expect(() => { drawBee(stubCtx(), 0, 0, 0, { flap: 1, crown: true, carry: 1, glow: 1 }); drawWasp(stubCtx(), 0, 0, 0, { flap: 1 }); }).not.toThrow();
  });
  it('survives a resize while running', () => {
    const s = new HiveSim(); s.resize(1100, 300); run(s, 1); s.resize(500, 260); run(s, 1);
    expect(s.cells).toHaveLength(37);
    expect([...s.bees].every((b) => finite(b.x) && finite(b.y))).toBe(true);
  });
});

describe('attack theater tells the truth', () => {
  const finish = (t: TheaterSim) => { for (let i = 0; i < 2400 && !t.done; i++) t.update(1 / 60); return t; };

  it('a caught attack bursts the shield only after the alerting wasp is in flight, and then ends', () => {
    const t = new TheaterSim({ w: 1200, h: 700, transactions: 12, caughtAfter: 6 });
    expect(t.catchAt).toBe(6);
    const trigger = t.wasps[5]!;
    expect(t.burstAt!).toBeGreaterThan(trigger.delay); // not before that transaction has even started
    for (let i = 0; i < 4000 && t.t < t.burstAt! - 0.05; i++) t.update(1 / 60);
    expect(t.phase).toBe('incoming'); expect(t.killed).toBe(0); expect(t.guards).toHaveLength(0);
    finish(t);
    expect(t.phase).toBe('caught'); expect(t.guards).toHaveLength(12); expect(t.killed).toBeGreaterThan(0); expect(t.done).toBe(true);
  });
  it('a missed attack never shows a shield, a kill or a guard', () => {
    const t = finish(new TheaterSim({ w: 1200, h: 700, transactions: 12, caughtAfter: null }));
    expect(t.burstAt).toBeNull(); expect(t.catchAt).toBeNull();
    expect(t.phase).toBe('missed'); expect(t.killed).toBe(0); expect(t.guards).toHaveLength(0);
    expect(t.arrived).toBe(12); expect(t.ringRadius).toBe(0);
  });
  it('an alert on the very first transaction triggers early', () => {
    const t = new TheaterSim({ w: 1000, h: 600, transactions: 5, caughtAfter: 1 });
    expect(t.catchAt).toBe(1);
    expect(t.burstAt!).toBeLessThan(new TheaterSim({ w: 1000, h: 600, transactions: 5, caughtAfter: 5 }).burstAt!);
  });
  it('large attacks are scaled to at most 24 wasps and keep the proportion', () => {
    const t = new TheaterSim({ w: 1000, h: 600, transactions: 40, caughtAfter: 20 });
    expect(t.wasps).toHaveLength(24); expect(t.catchAt).toBe(12);
    expect(new TheaterSim({ w: 1000, h: 600, transactions: 1, caughtAfter: 1 }).wasps).toHaveLength(1);
  });
  it('runs to completion in a few seconds and draws safely at every moment', () => {
    const t = new TheaterSim({ w: 1000, h: 600, transactions: 12, caughtAfter: 6 }); const c = stubCtx();
    for (let i = 0; i < 2400 && !t.done; i++) { t.update(1 / 60); if (i % 20 === 0) expect(() => t.draw(c)).not.toThrow(); }
    expect(t.done).toBe(true); expect(t.duration).toBeLessThan(8); expect(t.progress).toBe(1);
  });
  it('is deterministic for a seed and free of NaN', () => {
    const mk = () => finish(new TheaterSim({ w: 1000, h: 600, transactions: 12, caughtAfter: 4, seed: 5 }));
    const a = mk(), b = mk();
    expect(a.killed).toBe(b.killed);
    expect(a.wasps.every((w) => finite(w.x) && finite(w.y))).toBe(true);
  });
});
