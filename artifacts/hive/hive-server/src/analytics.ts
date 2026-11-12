import { DAY } from './risk/engine.js';
import type { Txn } from './types.js';

export const alias = (customerKey: string) => `C-${customerKey.slice(0, 4).toUpperCase()}`;

export interface Period {
  revenueCents: number;
  payments: number;
  refunds: number;
  refundCents: number;
  feesCents: number;
  netCents: number;
  failed: number;
}

export interface DayBucket { day: string; revenue: number; refunds: number; payments: number }

export interface Summary {
  asOf: number;
  currency: string;
  last30: Period;
  prior30: Period;
  topCustomer: { alias: string; shareOfRevenue: number; revenueCents: number } | null;
  repeatRate: number;
  daily: DayBucket[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function periodOf(txns: Txn[], from: number, to: number): Period {
  const w = txns.filter((t) => t.at > from && t.at <= to);
  const pay = w.filter((t) => t.kind === 'payment');
  const ref = w.filter((t) => t.kind === 'refund');
  const revenueCents = sum(pay.map((t) => t.amountCents));
  const refundCents = sum(ref.map((t) => t.amountCents));
  const feesCents = sum(pay.map((t) => t.feeCents));
  return {
    revenueCents, payments: pay.length, refunds: ref.length, refundCents, feesCents,
    netCents: revenueCents - refundCents - feesCents, failed: w.filter((t) => t.kind === 'failed').length,
  };
}

export interface CustomerRow {
  customer: string;
  payments: number;
  refunds: number;
  failed: number;
  revenueCents: number;
  refundCents: number;
  last30Cents: number;
  shareOfLast30: number;
  firstAt: number;
  lastAt: number;
  repeat: boolean;
}

export function customerRows(txns: Txn[], asOf: number): CustomerRow[] {
  const total30 = sum(txns.filter((t) => t.kind === 'payment' && t.at > asOf - 30 * DAY && t.at <= asOf).map((t) => t.amountCents));
  const by = new Map<string, Txn[]>();
  for (const t of txns) by.set(t.customerKey, [...(by.get(t.customerKey) ?? []), t]);
  return [...by.entries()].map(([key, ts]) => {
    const pay = ts.filter((t) => t.kind === 'payment');
    const l30 = sum(pay.filter((t) => t.at > asOf - 30 * DAY).map((t) => t.amountCents));
    return {
      customer: alias(key), payments: pay.length, refunds: ts.filter((t) => t.kind === 'refund').length,
      failed: ts.filter((t) => t.kind === 'failed').length, revenueCents: sum(pay.map((t) => t.amountCents)),
      refundCents: sum(ts.filter((t) => t.kind === 'refund').map((t) => t.amountCents)), last30Cents: l30,
      shareOfLast30: total30 ? l30 / total30 : 0, firstAt: Math.min(...ts.map((t) => t.at)), lastAt: Math.max(...ts.map((t) => t.at)),
      repeat: pay.length >= 2,
    };
  }).sort((a, b) => b.revenueCents - a.revenueCents);
}

export function summarize(txns: Txn[], asOf: number): Summary {
  const last30 = periodOf(txns, asOf - 30 * DAY, asOf);
  const prior30 = periodOf(txns, asOf - 60 * DAY, asOf - 30 * DAY);

  const pay30 = txns.filter((t) => t.kind === 'payment' && t.at > asOf - 30 * DAY && t.at <= asOf);
  const byCustomer = new Map<string, number>();
  for (const t of pay30) byCustomer.set(t.customerKey, (byCustomer.get(t.customerKey) ?? 0) + t.amountCents);
  const top = [...byCustomer.entries()].sort((a, b) => b[1] - a[1])[0];

  const pay60 = txns.filter((t) => t.kind === 'payment' && t.at > asOf - 60 * DAY && t.at <= asOf);
  const counts = new Map<string, number>();
  for (const t of pay60) counts.set(t.customerKey, (counts.get(t.customerKey) ?? 0) + 1);
  const active = new Set(pay30.map((t) => t.customerKey));
  const repeat = [...active].filter((k) => (counts.get(k) ?? 0) >= 2).length;

  const daily: DayBucket[] = [];
  const endDay = Math.floor(asOf / DAY);
  for (let d = endDay - 59; d <= endDay; d++) {
    const w = txns.filter((t) => Math.floor(t.at / DAY) === d);
    daily.push({
      day: new Date(d * DAY).toISOString().slice(0, 10),
      revenue: sum(w.filter((t) => t.kind === 'payment').map((t) => t.amountCents)) / 100,
      refunds: sum(w.filter((t) => t.kind === 'refund').map((t) => t.amountCents)) / 100,
      payments: w.filter((t) => t.kind === 'payment').length,
    });
  }

  return {
    asOf, currency: txns[0]?.currency ?? 'USD', last30, prior30,
    topCustomer: top ? { alias: alias(top[0]), shareOfRevenue: last30.revenueCents ? top[1] / last30.revenueCents : 0, revenueCents: top[1] } : null,
    repeatRate: active.size ? repeat / active.size : 0,
    daily,
  };
}
