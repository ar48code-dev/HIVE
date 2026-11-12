import { describe, expect, it } from 'vitest';
import { DAY, HOUR, MIN, evaluate } from '../src/risk/engine.js';
import type { Txn } from '../src/types.js';

const T0 = Date.UTC(2026, 10, 1);
let n = 0;
const tx = (p: Partial<Txn> & Pick<Txn, 'kind' | 'amountCents' | 'customerKey' | 'at'>): Txn => ({
  id: `t${++n}`, feeCents: 0, currency: 'USD', source: 'synthetic', ...p,
});

/** 40 ordinary payments of about $45 from rotating customers over the prior 40 days. */
const history = (): Txn[] =>
  Array.from({ length: 40 }, (_, i) =>
    tx({ kind: 'payment', amountCents: 4000 + (i % 7) * 200, customerKey: `c${i % 12}`, at: T0 - (40 - i) * DAY }),
  );

describe('risk engine', () => {
  it('stays quiet on an ordinary payment', () => {
    const cur = tx({ kind: 'payment', amountCents: 4400, customerKey: 'c3', at: T0 });
    expect(evaluate(history(), cur)).toBeNull();
  });

  it('flags a cluster of tiny payments as card testing and cites the evidence', () => {
    const h = history();
    for (let i = 0; i < 6; i++) h.push(tx({ kind: 'payment', amountCents: 80, customerKey: `x${i}`, at: T0 + i * MIN }));
    const cur = h.pop() as Txn;
    const a = evaluate(h, cur);
    expect(a?.signals.map((s) => s.rule)).toContain('CARD_TESTING');
    expect(a?.signals.find((s) => s.rule === 'CARD_TESTING')?.evidenceIds.length).toBeGreaterThanOrEqual(6);
    expect(a?.severity).toBe('high');
  });

  it('does not treat a flash sale of normal amounts as card testing', () => {
    const h = history();
    for (let i = 0; i < 8; i++) h.push(tx({ kind: 'payment', amountCents: 4500, customerKey: `s${i}`, at: T0 + i * MIN }));
    const cur = h.pop() as Txn;
    expect(evaluate(h, cur)).toBeNull();
  });

  it('flags a duplicate payment inside the window', () => {
    const h = history();
    h.push(tx({ kind: 'payment', amountCents: 9900, customerKey: 'd1', at: T0 }));
    const cur = tx({ kind: 'payment', amountCents: 9900, customerKey: 'd1', at: T0 + 30_000 });
    expect(evaluate(h, cur)?.signals.map((s) => s.rule)).toContain('DUPLICATE_PAYMENT');
  });

  it('flags a very large first-time order but is gentler on an established customer', () => {
    const h = history();
    const first = tx({ kind: 'payment', amountCents: 250000, customerKey: 'brand-new', at: T0 });
    expect(evaluate(h, first)?.signals.map((s) => s.rule)).toContain('AMOUNT_OUTLIER');

    // Give c1 a real history (at least five prior payments) so it counts as established.
    for (let i = 0; i < 4; i++) h.push(tx({ kind: 'payment', amountCents: 4400, customerKey: 'c1', at: T0 - (3 + i) * 3600_000 }));
    const est = tx({ kind: 'payment', amountCents: 16000, customerKey: 'c1', at: T0 });
    const a = evaluate(h, est);
    expect(a).toBeNull(); // established customer, modestly large: weight 0.2 is below the alert threshold
  });

  it('flags repeated refunds to one customer', () => {
    const h = history();
    h.push(tx({ kind: 'payment', amountCents: 6000, customerKey: 'r1', at: T0 - 5 * DAY }));
    h.push(tx({ kind: 'refund', amountCents: 6000, customerKey: 'r1', at: T0 - 4 * DAY }));
    h.push(tx({ kind: 'payment', amountCents: 6000, customerKey: 'r1', at: T0 - 2 * DAY }));
    const cur = tx({ kind: 'refund', amountCents: 6000, customerKey: 'r1', at: T0 - 1 * DAY });
    expect(evaluate(h, cur)?.signals.map((s) => s.rule)).toContain('REFUND_ABUSE');
  });

  it('does not flag a single ordinary refund', () => {
    const h = history();
    h.push(tx({ kind: 'payment', amountCents: 4800, customerKey: 'ok1', at: T0 - 2 * DAY }));
    const cur = tx({ kind: 'refund', amountCents: 4800, customerKey: 'ok1', at: T0 - 1 * DAY });
    expect(evaluate(h, cur)).toBeNull();
  });

  it('flags a streak of failed payments', () => {
    const h = history();
    for (let i = 0; i < 2; i++) h.push(tx({ kind: 'failed', amountCents: 5000, customerKey: 'f1', at: T0 + i * MIN }));
    const cur = tx({ kind: 'failed', amountCents: 5000, customerKey: 'f1', at: T0 + 2 * MIN });
    expect(evaluate(h, cur)?.signals.map((s) => s.rule)).toContain('FAILED_STREAK');
  });

  it('is deterministic: same input gives the same output', () => {
    const h = history();
    const cur = tx({ kind: 'payment', amountCents: 250000, customerKey: 'z', at: T0 + HOUR });
    expect(JSON.stringify(evaluate(h, cur))).toBe(JSON.stringify(evaluate(h, cur)));
  });

  it('every alert carries reasons, evidence and a next step', () => {
    const a = evaluate(history(), tx({ kind: 'payment', amountCents: 250000, customerKey: 'q', at: T0 }));
    expect(a).not.toBeNull();
    for (const s of a!.signals) {
      expect(s.reason.length).toBeGreaterThan(10);
      expect(s.evidenceIds.length).toBeGreaterThan(0);
    }
    expect(a!.nextStep.length).toBeGreaterThan(10);
  });
});

describe('card testing over a longer window', () => {
  const tiny = (i: number, spacingMin: number) => tx({ kind: 'payment', amountCents: 80, customerKey: `slow${i}`, at: T0 + i * spacingMin * MIN });

  it('catches the same tiny charges when they are spread over about 48 minutes', () => {
    const h = history();
    for (let i = 0; i < 12; i++) h.push(tiny(i, 4));
    let alerted = false;
    for (let i = 0; i < 12; i++) {
      const a = evaluate([...history(), ...Array.from({ length: i }, (_, k) => tiny(k, 4))], tiny(i, 4));
      if (a?.signals.some((s) => s.rule === 'CARD_TESTING')) { alerted = true; expect(a.signals[0]?.weight).toBeLessThan(0.85); break; }
    }
    expect(alerted).toBe(true);
  });

  it('is not triggered by a handful of tiny payments across a whole day', () => {
    const past = history();
    for (let i = 0; i < 7; i++) past.push(tiny(i, 60)); // seven in seven hours
    expect(evaluate(past, tiny(7, 60))).toBeNull();
  });

  it('does not fire for a shop whose normal payments are tiny', () => {
    const cheap: Txn[] = Array.from({ length: 40 }, (_, i) => tx({ kind: 'payment', amountCents: 100, customerKey: `b${i}`, at: T0 - (40 - i) * 3 * HOUR }));
    const run = Array.from({ length: 10 }, (_, i) => tx({ kind: 'payment', amountCents: 100, customerKey: `x${i}`, at: T0 + i * 10 * MIN }));
    expect(evaluate([...cheap, ...run.slice(0, 9)], run[9] as Txn)).toBeNull();
  });
});

describe('card testing in shops of different price levels', () => {
  const shop = (low: number, high: number) =>
    Array.from({ length: 60 }, (_, i) => tx({ kind: 'payment', amountCents: low + ((i * 37) % (high - low)), customerKey: `s${i % 20}`, at: T0 - (60 - i) * 8 * HOUR }));
  const attack = (n: number, spacingMin: number) => Array.from({ length: n }, (_, i) => tx({ kind: 'payment', amountCents: 70 + (i % 5) * 15, customerKey: `ct${i}`, at: T0 + i * spacingMin * MIN }));
  const caught = (history: Txn[], stream: Txn[]) => stream.some((t, i) => evaluate([...history, ...stream.slice(0, i)], t)?.signals.some((s) => s.rule === 'CARD_TESTING'));

  it('still catches slow card testing in a cheap-goods shop (payments $5 to $20)', () => {
    expect(caught(shop(500, 2000), attack(12, 4))).toBe(true);
  });
  it('still catches fast card testing in a luxury shop (payments $150 to $600)', () => {
    expect(caught(shop(15000, 60000), attack(12, 0.5))).toBe(true);
  });
  it('does not call a $1 payment tiny in a shop that sells $1 to $3 items', () => {
    const cheap = shop(100, 300);
    const sales = Array.from({ length: 12 }, (_, i) => tx({ kind: 'payment', amountCents: 100 + (i % 3) * 50, customerKey: `v${i}`, at: T0 + i * 4 * MIN }));
    expect(caught(cheap, sales)).toBe(false);
  });
});

describe('card testing cannot poison its own baseline', () => {
  it('a long run of tiny charges does not shrink the cut-off below the attacker\'s own amounts', () => {
    const base = Array.from({ length: 40 }, (_, i) => tx({ kind: 'payment', amountCents: 4000 + (i % 7) * 200, customerKey: `c${i % 12}`, at: T0 - (40 - i) * DAY }));
    const attack = Array.from({ length: 30 }, (_, i) => tx({ kind: 'payment', amountCents: 80, customerKey: `x${i}`, at: T0 + i * 20_000 }));
    // by the 30th tiny charge the baseline is mostly attacker traffic; it must still be caught
    expect(evaluate([...base, ...attack.slice(0, 29)], attack[29] as Txn)?.signals.map((s) => s.rule)).toContain('CARD_TESTING');
  });
});

describe('a repeat card-testing campaign cannot blind the rule', () => {
  it('an earlier campaign of about 5% of all payments does not shrink the cut-off', () => {
    const normal = Array.from({ length: 230 }, (_, i) => tx({ kind: 'payment', amountCents: 1500 + ((i * 53) % 4000), customerKey: `n${i % 40}`, at: T0 - 2 * DAY - (230 - i) * 4 * HOUR }));
    const old = Array.from({ length: 12 }, (_, i) => tx({ kind: 'payment', amountCents: 61 + i * 8, customerKey: `old${i}`, at: T0 - 5 * HOUR + i * 40_000 }));
    const burst = Array.from({ length: 12 }, (_, i) => tx({ kind: 'payment', amountCents: 50 + ((i * 17) % 100), customerKey: `new${i}`, at: T0 + i * 40_000 }));
    const caught = burst.some((b, i) => evaluate([...normal, ...old, ...burst.slice(0, i)], b)?.signals.some((s) => s.rule === 'CARD_TESTING'));
    expect(caught).toBe(true);
  });
});
