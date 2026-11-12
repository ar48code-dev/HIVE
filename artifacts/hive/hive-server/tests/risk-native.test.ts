import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applicability, featurize, loadRiskModel, nativeScore, riskModelAvailable, scoreRows, type RiskRow } from '../src/brain/risk.js';
import type { Txn } from '../src/types.js';

const fx = JSON.parse(readFileSync('tests/fixtures/risk_parity.json', 'utf8')) as {
  rows: RiskRow[];
  expected: Array<{ risk: number; flag_model: boolean; why: Array<[string, number]> }>;
};

describe('native risk model matches the Python model', () => {
  const model = loadRiskModel()!;
  const got = scoreRows(fx.rows, model);

  it('the trained weights are present', () => {
    expect(riskModelAvailable()).toBe(true);
    expect(model.w).toHaveLength(20);
    expect(model.feats).toHaveLength(20);
  });

  it('scores every row of real data to the same probability (Python rounds to 3 places)', () => {
    expect(got).toHaveLength(fx.expected.length);
    const worst = Math.max(...got.map((g, i) => Math.abs(g.risk - (fx.expected[i] as { risk: number }).risk)));
    expect(worst).toBeLessThanOrEqual(0.0005 + 1e-9);
  });

  it('makes exactly the same flag decisions', () => {
    const diff = got.map((g, i) => (g.flag === (fx.expected[i] as { flag_model: boolean }).flag_model ? null : i)).filter((i) => i !== null);
    expect(diff).toEqual([]);
    expect(got.filter((g) => g.flag).length).toBeGreaterThan(5); // the fixture contains real flagged cases
  });

  it('gives the same leading explanation for every flagged row', () => {
    got.forEach((g, i) => {
      if (!g.flag) return;
      const py = (fx.expected[i] as { why: Array<[string, number]> }).why;
      expect(g.why[0]?.[0]).toBe(py[0]?.[0]);
      expect(Math.abs((g.why[0]?.[1] ?? 0) - (py[0]?.[1] ?? 0))).toBeLessThanOrEqual(0.011);
    });
  });

  it('features match the documented order and are finite', () => {
    const X = featurize(fx.rows);
    expect(X[0]).toHaveLength(20);
    expect(X.flat().every(Number.isFinite)).toBe(true);
  });
});

describe('native scorer behaviour', () => {
  it('returns null instead of throwing when weights are missing', () => {
    expect(loadRiskModel('/nonexistent/dir')).toBeNull();
  });
  it('orders results by time and flags a card-testing burst', () => {
    const rows: RiskRow[] = Array.from({ length: 12 }, (_, i) => ({ t: 1_800_000_000 + i * 30, c: `x${i}`, a: 1, k: 'pay' as const }));
    const warm: RiskRow[] = Array.from({ length: 30 }, (_, i) => ({ t: 1_799_000_000 + i * 20_000, c: `r${i % 8}`, a: 40 + (i % 5) * 6, k: 'pay' as const }));
    const out = scoreRows([...warm, ...rows], loadRiskModel()!);
    expect(out.slice(-4).some((o) => o.flag)).toBe(true);
    expect(out.slice(0, 30).filter((o) => o.flag).length).toBe(0);
  });
  it('nativeScore accepts unsorted input and returns time order', () => {
    const t = (at: number, id: string) => ({ id, kind: 'payment' as const, amountCents: 4000, feeCents: 0, currency: 'USD', customerKey: 'a', at, source: 'synthetic' as const });
    const out = nativeScore([t(3000, 'c'), t(1000, 'a'), t(2000, 'b')]);
    expect(out).toHaveLength(3);
  });
});

describe('applicability guard', () => {
  const shop = (medianDollars: number, n = 40): Txn[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, kind: 'payment' as const, amountCents: Math.round(medianDollars * 100 * (0.8 + ((i * 7) % 9) / 20)), feeCents: 0, currency: 'USD', customerKey: `c${i % 9}`, at: 1_800_000_000_000 + i * 3_600_000, source: 'synthetic' as const }));
  it('accepts a normal shop', () => { expect(applicability(shop(45)).applicable).toBe(true); });
  it('accepts the edges of the trained range', () => { expect(applicability(shop(8)).applicable).toBe(true); expect(applicability(shop(400)).applicable).toBe(true); });
  it('switches off for a shop far below the trained range and says why', () => {
    const a = applicability(shop(3.6));
    expect(a.applicable).toBe(false);
    expect(a.reason).toMatch(/switched off/);
    expect(a.reason).toMatch(/rules still run/i);
  });
  it('switches off for a shop far above the trained range', () => { expect(applicability(shop(900)).applicable).toBe(false); });
  it('switches off when there is too little history', () => { expect(applicability(shop(45, 5)).applicable).toBe(false); });
});
