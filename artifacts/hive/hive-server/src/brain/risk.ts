import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Txn } from '../types.js';

/*
 * The learned risk model, run natively. It is a 20-weight logistic regression, so there is no need for a separate Python
 * service: HIVE loads the trained weights (brain/colony/models/risk_hive.json) and scores in-process.
 * This is a faithful port of colony/sim.py `featurize(extended=True)` and colony/riskmodel.py `Logit`; tests/risk-native.test.ts
 * checks it against the Python implementation on real data. Python remains the place where the model is TRAINED.
 */

export interface RiskRow { t: number; c: string; a: number; k: 'pay' | 'refund' | 'fail' }
export interface RiskScore { risk: number; flag: boolean; why: Array<[string, number]> }

interface Model { w: number[]; b: number; mu: number[]; sd: number[]; feats: string[]; logcols: number[]; thr: number }

const DAY = 86_400;
const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((p, q) => p - q), m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** Per-transaction features, in the order of the model's `feats`. Rows must be sorted by time. */
export function featurize(rows: RiskRow[]): number[][] {
  const hist = new Map<string, Array<[number, number, string]>>();
  const pays: Array<[number, number, string]> = [];
  const allx: Array<[number, number, string, number]> = [];
  const X: number[][] = [];
  for (const x of rows) {
    const { t, a, k } = x;
    const h = hist.get(x.c) ?? [];
    const r10 = h.filter((e) => t - e[0] <= 600), r1h = h.filter((e) => t - e[0] <= 3600), r30 = h.filter((e) => t - e[0] <= 30 * DAY);
    const med = pays.length ? median(pays.slice(-100).map((p) => p[1])) : 40;
    const own = r30.filter((e) => e[2] === 'pay').map((e) => e[1]);
    const ownMed = own.length ? median(own) : med;
    const p7 = h.filter((e) => e[2] === 'pay' && t - e[0] <= 7 * DAY).reduce((s, e) => s + e[1], 0);
    const tot7 = pays.filter((p) => t - p[0] <= 7 * DAY).reduce((s, p) => s + p[1], 0) + 1e-9;
    const isNew = h.length === 0 ? 1 : 0;
    const row = [
      Math.log1p(a), a / (med + 1e-9), isNew, r10.length, r1h.length, a < 3 ? 1 : 0, r10.filter((e) => e[1] < 3).length,
      r1h.filter((e) => e[2] === 'fail').length, k === 'fail' ? 1 : 0, k === 'refund' ? 1 : 0, r30.filter((e) => e[2] === 'refund').length,
      h.some((e) => Math.abs(e[0] - t) <= 120 && Math.abs(e[1] - a) < 1e-9) ? 1 : 0, p7 / tot7,
      new Set(pays.filter((p) => t - p[0] <= 3600).map((p) => p[2])).size, a / (ownMed + 1e-9), r30.filter((e) => e[2] === 'pay').length,
    ];
    // merchant-wide context for the last 10 minutes
    let gSmall = 0, gNew = 0, gPay = 0, gFail = 0;
    for (let i = allx.length - 1; i >= 0; i--) {
      const e = allx[i] as [number, number, string, number];
      if (t - e[0] > 600) break;
      if (e[2] === 'pay' && e[1] < 0.2 * med) gSmall++;
      gNew += e[3];
      if (e[2] === 'pay') gPay++;
      if (e[2] === 'fail') gFail++;
    }
    row.push(gSmall, gNew, gPay, gFail);
    X.push(row);
    allx.push([t, a, k, isNew]);
    h.push([t, a, k]);
    hist.set(x.c, h);
    if (k === 'pay') pays.push([t, a, x.c]);
  }
  return X;
}

let cached: Model | null | undefined;
const defaultDir = () => join(process.cwd(), 'brain', 'colony', 'models');

/** Load the trained weights, or null if they are not present. */
export function loadRiskModel(dir = defaultDir()): Model | null {
  if (dir === defaultDir() && cached !== undefined) return cached;
  let m: Model | null = null;
  try {
    const f = join(dir, 'risk_hive.json'), t = join(dir, 'risk_hive_threshold.txt');
    if (existsSync(f) && existsSync(t)) {
      const d = JSON.parse(readFileSync(f, 'utf8'));
      m = { w: d.w, b: d.b, mu: d.mu, sd: d.sd, feats: d.feats, logcols: d.logcols, thr: parseFloat(readFileSync(t, 'utf8')) };
    }
  } catch { m = null; }
  if (dir === defaultDir()) cached = m;
  return m;
}

export const riskModelAvailable = () => loadRiskModel() !== null;

export function scoreRows(rows: RiskRow[], model: Model): RiskScore[] {
  const logs = new Set(model.logcols);
  return featurize(rows).map((x) => {
    const z = x.map((v, j) => ((logs.has(j) ? Math.log1p(Math.abs(v)) : v) - (model.mu[j] as number)) / (model.sd[j] as number));
    const contrib = z.map((v, j) => v * (model.w[j] as number));
    const p = 1 / (1 + Math.exp(-(contrib.reduce((s, c) => s + c, 0) + model.b)));
    const why = contrib.map((c, j) => [j, c] as const).filter(([, c]) => c > 0).sort((u, v) => v[1] - u[1]).slice(0, 3)
      .map(([j, c]) => [model.feats[j] as string, Math.round(c * 100) / 100] as [string, number]);
    return { risk: p, flag: p >= model.thr, why };
  });
}

export const toRiskRow = (t: Txn): RiskRow => ({ t: t.at / 1000, c: t.customerKey, a: t.amountCents / 100, k: t.kind === 'payment' ? 'pay' : t.kind === 'refund' ? 'refund' : 'fail' });

/** Score transactions (any order). Results are in time order. Null when the weights are not available. */
export function nativeScore(txns: Txn[]): RiskScore[] | null {
  const m = loadRiskModel();
  if (!m) return null;
  return scoreRows([...txns].sort((a, b) => a.at - b.at).map(toRiskRow), m);
}

/**
 * The model was trained on shops whose typical payment is roughly $7 to $450 (the training price scales times a $45 shop).
 * Outside that range it can fail badly (in testing, 299 false alarms per 1,000 on a shop with a $3.60 typical payment),
 * so it switches itself off instead of giving a confident wrong answer.
 */
export const MODEL_DOMAIN = { minMedianDollars: 6.5, maxMedianDollars: 500 };

export interface Applicability { applicable: boolean; medianDollars: number | null; reason?: string }

export function applicability(txns: Txn[]): Applicability {
  const pays = txns.filter((t) => t.kind === 'payment');
  if (pays.length < 15) return { applicable: false, medianDollars: null, reason: 'There are fewer than 15 payments, which is too little history for the model to judge.' };
  const latest = Math.max(...pays.map((t) => t.at));
  const recent = pays.filter((t) => t.at > latest - 60 * 86_400_000);
  const med = median((recent.length >= 15 ? recent : pays).map((t) => t.amountCents / 100));
  if (med < MODEL_DOMAIN.minMedianDollars || med > MODEL_DOMAIN.maxMedianDollars) {
    return {
      applicable: false, medianDollars: med,
      reason: `Your typical payment is about $${med.toFixed(2)}. The model was trained for shops whose typical payment is between about $${MODEL_DOMAIN.minMedianDollars.toFixed(0)} and $${MODEL_DOMAIN.maxMedianDollars}, and outside that range it can be badly wrong, so it is switched off for your shop. The rules still run as normal.`,
    };
  }
  return { applicable: true, medianDollars: med };
}
