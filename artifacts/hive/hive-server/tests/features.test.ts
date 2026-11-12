import { beforeEach, describe, expect, it } from 'vitest';
import { DAY, HOUR } from '../src/risk/engine.js';
import { MemoryRepo, type AuditEntry } from '../src/repo.js';
import { seedDemo } from '../src/demo/seed.js';
import { simulate, buildSimulation, SIM_ATTACKS } from '../src/demo/inject.js';
import { detectRecurring } from '../src/recurring.js';
import { growth } from '../src/growth.js';
import { backfill, searchItemToTxn } from '../src/backfill.js';
import { customerRows } from '../src/analytics.js';
import { LIVE_ATTACKS, planLive } from '../src/wasplab/live.js';
import { askQueen } from '../src/ai/queen.js';
import type { Txn } from '../src/types.js';

const NOW = Date.UTC(2026, 10, 12, 12);
let n = 0;
const pay = (customerKey: string, amountCents: number, at: number): Txn => ({ id: `r${++n}`, kind: 'payment', amountCents, feeCents: 0, currency: 'USD', customerKey, at, source: 'synthetic' });

describe('recurring payments (Calendar)', () => {
  it('detects a steady weekly payer and labels the prediction an estimate', () => {
    const t = [0, 1, 2, 3, 4].map((i) => pay('weekly', 11000, NOW - (2 + i * 7) * DAY));
    const [r] = detectRecurring(t, NOW);
    expect(r?.cadenceDays).toBeCloseTo(7, 0);
    expect(r?.estimate).toBe(true);
    expect(r?.daysUntil).toBeGreaterThan(3);
    expect(r?.confidence).toBe('high');
  });
  it('ignores irregular payers and fluctuating amounts', () => {
    const irregular = [3, 4, 20, 22, 55].map((d) => pay('messy', 5000, NOW - d * DAY));
    const wobbly = [2, 9, 16, 23].map((d, i) => pay('wobbly', [1000, 9000, 2000, 8000][i] as number, NOW - d * DAY));
    expect(detectRecurring([...irregular, ...wobbly], NOW)).toEqual([]);
  });
  it('does not predict income from a customer whose payments are mostly refunded', () => {
    const t = [0, 1, 2].map((i) => pay('refunded', 6000, NOW - (2 + i * 3) * DAY));
    expect(detectRecurring(t, NOW).length).toBe(1);
    const refunds: Txn[] = t.slice(0, 2).map((p) => ({ ...p, id: `ref-${p.id}`, kind: 'refund' as const, at: p.at + HOUR }));
    expect(detectRecurring([...t, ...refunds], NOW)).toEqual([]);
  });
  it('needs at least three payments', () => {
    expect(detectRecurring([pay('a', 100, NOW - 7 * DAY), pay('a', 100, NOW - 14 * DAY)], NOW)).toEqual([]);
  });
  it('flags a payer who is late', () => {
    const t = [0, 1, 2, 3].map((i) => pay('late', 4900, NOW - (9 + i * 7) * DAY));
    expect(detectRecurring(t, NOW)[0]?.overdue).toBe(true);
  });
});

describe('colony growth', () => {
  const ev = (event: string): AuditEntry => ({ id: ++n, at: NOW, actor: 'user', event, detail: {} });
  it('starts empty and grows only from care actions', () => {
    expect(growth([], 3).cells).toBe(0);
    const g = growth([ev('alert_reviewed'), ev('answered'), ev('wasplab_run'), ev('alert_created'), ev('demo_seeded')], 2);
    expect(g.cells).toBe(3); // system events do not count
  });
  it('caps at capacity and unlocks achievements', () => {
    const many = Array.from({ length: 40 }, () => ev('alert_dismissed'));
    const g = growth(many, 0);
    expect(g.cells).toBe(g.capacity);
    expect(g.achievements.filter((a) => a.done).map((a) => a.id)).toEqual(expect.arrayContaining(['first_review', 'five_reviews', 'clear']));
  });
});

describe('Transaction Search backfill', () => {
  const item = (id: string, code: string, value: string, extra: any = {}) => ({
    transaction_info: { transaction_id: id, transaction_event_code: code, transaction_initiation_date: '2026-10-20T10:00:00+0000', transaction_amount: { currency_code: 'USD', value }, fee_amount: { currency_code: 'USD', value: '-0.59' }, transaction_status: 'S', ...extra },
    payer_info: { account_id: 'PAYER1' },
  });

  it('maps payments, refunds and denied attempts, and ignores unrelated activity', () => {
    expect(searchItemToTxn(item('A1', 'T0006', '10.00'))?.txn).toMatchObject({ id: 'pp-A1', kind: 'payment', amountCents: 1000, feeCents: 59 });
    expect(searchItemToTxn(item('A2', 'T1107', '-10.00'))?.txn).toMatchObject({ kind: 'refund', amountCents: 1000 });
    expect(searchItemToTxn(item('A3', 'T0006', '10.00', { transaction_status: 'D' }))?.txn.kind).toBe('failed');
    expect(searchItemToTxn(item('A4', 'T0400', '-50.00'))).toBeNull(); // withdrawal to bank
    expect(searchItemToTxn({})).toBeNull();
  });

  it('merges with webhook data without duplicating, pages through results, and splits long ranges', async () => {
    const repo = new MemoryRepo();
    await repo.upsertTxn({ ...(searchItemToTxn(item('W1', 'T0006', '5.00'))!.txn) }); // already arrived by webhook
    const calls: Array<[string, number]> = [];
    const fake = async (_s: string, _e: string, page = 1) => {
      calls.push([_s, page]);
      return { total_pages: 2, transaction_details: page === 1 ? [item('W1', 'T0006', '5.00'), item('N1', 'T0006', '7.00')] : [item('N2', 'T1107', '-7.00'), item('X', 'T0400', '-1.00')] };
    };
    const r = await backfill(repo, 70, fake as any);
    expect(r.windows).toBe(3);
    expect(calls.length).toBe(6); // 3 windows x 2 pages
    expect(r.skipped).toBe(3); // one withdrawal per window
    expect((await repo.listTxns(0)).map((t) => t.id).sort()).toEqual(['pp-N1', 'pp-N2', 'pp-W1']);
  });
});

describe('demo attack launcher', () => {
  let repo: MemoryRepo;
  beforeEach(async () => { repo = new MemoryRepo(); await seedDemo(repo, NOW); });

  it.each([['card_testing', 'CARD_TESTING'], ['duplicate_payment', 'DUPLICATE_PAYMENT'], ['new_customer_large', 'AMOUNT_OUTLIER'], ['failed_streak', 'FAILED_STREAK'], ['refund_abuse', 'REFUND_ABUSE']] as const)(
    '%s raises an alert for %s through the real engine', async (attack, rule) => {
      const before = (await repo.listAlerts()).length;
      const r = await simulate(repo, attack, NOW + HOUR);
      expect(r.alertIds.length).toBeGreaterThan(0);
      expect((await repo.listAlerts()).length).toBeGreaterThan(before);
      const rules = (await Promise.all(r.alertIds.map((id) => repo.getAlert(id)))).flatMap((a) => a?.signals.map((s) => s.rule) ?? []);
      expect(rules).toContain(rule);
    });

  it('a simulated incident is its own new alert, never absorbed by an older planted one', async () => {
    const planted = new Set((await repo.listAlerts()).map((a) => a.id));
    for (const attack of ['card_testing', 'duplicate_payment', 'new_customer_large', 'refund_abuse'] as const) {
      const r = await simulate(repo, attack, NOW + HOUR);
      expect(r.alertIds.some((id) => !planted.has(id)), attack).toBe(true);
    }
  });

  it('an ordinary payment arrives quietly', async () => {
    const r = await simulate(repo, 'normal_payment', NOW + HOUR);
    expect(r.alertIds).toEqual([]);
    expect(r.transactions).toBe(1);
  });

  it('records the simulation in the audit log as synthetic', async () => {
    await simulate(repo, 'card_testing', NOW + HOUR);
    const log = await repo.listAudit();
    expect(log[0]?.event).toBe('attack_simulated');
    expect(JSON.stringify(log[0]?.detail)).toContain('synthetic');
  });

  it('the large-order simulation carries an injection attempt that Queen treats as data', async () => {
    const r = await simulate(repo, 'new_customer_large', NOW + HOUR);
    const a = await askQueen(repo, null, 'Investigate this alert', r.alertIds[0]);
    expect(a.evidence.some((e) => e.injectionSuspected)).toBe(true);
    expect(JSON.stringify(a)).not.toMatch(/refund every order/i);
  });

  it('every scenario builds transactions in time order within reach of now', () => {
    for (const s of SIM_ATTACKS) {
      const t = buildSimulation(s, NOW);
      expect(t.length).toBeGreaterThan(0);
      expect(Math.max(...t.map((x) => x.at))).toBeLessThanOrEqual(NOW);
    }
  });
});

describe('demo dataset', () => {
  it('contains detectable subscription customers and a planted injection note', async () => {
    const repo = new MemoryRepo();
    await seedDemo(repo, NOW);
    const txns = await repo.listTxns(0);
    expect(detectRecurring(txns, NOW).length).toBeGreaterThanOrEqual(3);
    expect(txns.some((t) => /ignore all previous/i.test(t.note ?? ''))).toBe(true);
  });
  it('customer shares of 30-day revenue never exceed 100%', async () => {
    const repo = new MemoryRepo();
    await seedDemo(repo, NOW);
    const rows = customerRows(await repo.listTxns(0), NOW);
    expect(rows.reduce((s, r) => s + r.shareOfLast30, 0)).toBeLessThanOrEqual(1.0001);
    expect(rows[0]?.revenueCents).toBeGreaterThanOrEqual(rows[1]?.revenueCents ?? 0);
  });
  it('writes a daily report separate from the weekly one', async () => {
    const repo = new MemoryRepo();
    await seedDemo(repo, NOW);
    const d = await askQueen(repo, null, 'Give me my daily summary');
    expect(d.answer).toMatch(/^Daily report/);
    expect(d.claims.every((c) => c.evidenceIds.length > 0)).toBe(true);
  });
});

describe('live sandbox plans', () => {
  it('every live attack has a sensible plan', () => {
    for (const a of LIVE_ATTACKS) expect(planLive(a).length).toBeGreaterThan(0);
    expect(planLive('card_testing')).toHaveLength(12);
    expect(planLive('card_testing').every((s) => Number(s.amount) <= 1.5)).toBe(true);
  });
  it('duplicate payments use identical amounts', () => {
    const [a, b] = planLive('duplicate_payment');
    expect(a?.amount).toBe(b?.amount);
  });
  it('each refund points at the order step it refunds', () => {
    const steps = planLive('refund_abuse');
    for (const [i, s] of steps.entries()) if (s.kind === 'refund') {
      expect(steps[s.refundOf as number]?.kind).toBe('order');
      expect(s.refundOf).toBeLessThan(i);
    }
  });
});
