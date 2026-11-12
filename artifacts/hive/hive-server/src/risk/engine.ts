import type { Alert, Severity, Signal, Txn } from '../types.js';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export interface EngineConfig {
  alertThreshold: number;
  baselineDays: number;
  minBaselinePayments: number;
  outlierModifiedZ: number;
  establishedMinPayments: number;
  cardTestMaxCents: number;
  cardTestMinCount: number;
  cardTestWindowMs: number;
  cardTestSlowMinCount: number;
  cardTestSlowWindowMs: number;
  burstMinCount: number;
  burstWindowMs: number;
  duplicateWindowMs: number;
  refundAbuseMinRefunds: number;
  refundAbuseRatio: number;
  refundSurgeMinCount: number;
  refundSurgeMultiple: number;
  failedStreakMin: number;
  failedStreakWindowMs: number;
  concentrationShare: number;
  concentrationPriorShare: number;
  concentrationMinPayments: number;
}

export const DEFAULTS: EngineConfig = {
  alertThreshold: 0.35,
  baselineDays: 60,
  minBaselinePayments: 15,
  outlierModifiedZ: 4,
  establishedMinPayments: 5,
  cardTestMaxCents: 200,
  cardTestMinCount: 6,
  cardTestWindowMs: 15 * MIN,
  cardTestSlowMinCount: 8,
  cardTestSlowWindowMs: 3 * HOUR,
  burstMinCount: 5,
  burstWindowMs: 10 * MIN,
  duplicateWindowMs: 2 * MIN,
  refundAbuseMinRefunds: 2,
  refundAbuseRatio: 0.5,
  refundSurgeMinCount: 4,
  refundSurgeMultiple: 3,
  failedStreakMin: 3,
  failedStreakWindowMs: 30 * MIN,
  concentrationShare: 0.5,
  concentrationPriorShare: 0.25,
  concentrationMinPayments: 10,
};

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const NEXT_STEP: Record<string, string> = {
  CARD_TESTING:
    'Review the cluster of tiny payments. If the buyers are unknown, consider pausing fulfilment and check the PayPal activity for the related transactions.',
  VELOCITY_BURST:
    'Check whether this customer legitimately placed several orders. If not, hold fulfilment and contact them through a known channel.',
  DUPLICATE_PAYMENT:
    'Confirm with the customer whether the second payment was intended. If not, prepare a refund for your review.',
  AMOUNT_OUTLIER:
    'Verify the order details and the buyer before shipping or delivering. A first-time buyer with an unusually large order deserves a manual check.',
  REFUND_ABUSE:
    'Review this customer\'s refund history. Consider requiring approval for further refunds to this customer. HIVE will not block anyone automatically.',
  REFUND_SURGE:
    'Look for a common product, campaign or time window behind the refunds before changing any policy.',
  FAILED_STREAK:
    'Repeated declined payments from one customer can indicate card testing. Review the attempts and the buyer before accepting further orders.',
  CONCENTRATION_SHIFT:
    'Revenue is shifting to a single customer. Confirm this is expected, and consider the cash-flow risk if that customer stops paying.',
};

function severityOf(score: number): Severity {
  if (score >= 0.85) return 'high';
  if (score >= 0.6) return 'medium';
  return 'low';
}

/**
 * Deterministic risk evaluation of one transaction against the history before it.
 * Pure function: no I/O, no randomness, no LLM. The LLM only explains what this returns.
 */
export function evaluate(history: Txn[], cur: Txn, cfg: EngineConfig = DEFAULTS): Alert | null {
  const past = history.filter((t) => t.id !== cur.id && t.at <= cur.at);
  const payments = past.filter((t) => t.kind === 'payment' && t.at > cur.at - cfg.baselineDays * DAY);
  const med =
    payments.length >= cfg.minBaselinePayments ? median(payments.map((p) => p.amountCents)) : null;
  const signals: Signal[] = [];

  // ---- card testing: many tiny payment or failed attempts in a short window ----
  if (cur.kind === 'payment' || cur.kind === 'failed') {
    // "Tiny" is judged against the shop's own low end, not its median: 40% of its 20th-percentile payment, capped at $2.
    // (A median-based cut-off collapsed in cheap-goods shops and let slow attacks through. The 20th percentile, not the 5th,
    // because an earlier card-testing campaign of just 5% of payments could otherwise drag the cut-off down to the attacker's own amounts.)
    // The baseline excludes the window being judged, so an attacker's own tiny charges cannot lower the bar for catching them.
    const settled = payments.filter((p) => p.at <= cur.at - cfg.cardTestSlowWindowMs);
    const sorted = (settled.length >= cfg.minBaselinePayments ? settled : payments).map((p) => p.amountCents).sort((a, b) => a - b);
    const p20 = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
    const small = med !== null ? Math.min(cfg.cardTestMaxCents, Math.floor(p20 * 0.4)) : cfg.cardTestMaxCents;
    if (cur.amountCents <= small) {
      const tiny = (windowMs: number) =>
        [...past, cur].filter((t) => (t.kind === 'payment' || t.kind === 'failed') && t.amountCents <= small && t.at > cur.at - windowMs);
      const fast = tiny(cfg.cardTestWindowMs);
      // Patient attackers spread the same tiny charges over hours to stay under a short window.
      const slow = fast.length >= cfg.cardTestMinCount ? [] : tiny(cfg.cardTestSlowWindowMs);
      if (fast.length >= cfg.cardTestMinCount) {
        signals.push({
          rule: 'CARD_TESTING',
          weight: 0.85,
          reason: `${fast.length} payment attempts of ${money(small)} or less within ${Math.round(cfg.cardTestWindowMs / MIN)} minutes. Tiny repeated charges are a common way to test stolen cards.`,
          evidenceIds: fast.map((t) => t.id),
        });
      } else if (slow.length >= cfg.cardTestSlowMinCount) {
        signals.push({
          rule: 'CARD_TESTING',
          weight: 0.7,
          reason: `${slow.length} payment attempts of ${money(small)} or less within ${Math.round(cfg.cardTestSlowWindowMs / HOUR)} hours. Tiny charges spread out over hours can be a slower way to test stolen cards.`,
          evidenceIds: slow.map((t) => t.id),
        });
      }
    }
  }

  if (cur.kind === 'payment') {
    const custPayments = payments.filter((p) => p.customerKey === cur.customerKey);

    // ---- amount outlier (robust z-score), weaker for established customers ----
    if (med !== null) {
      const mad = median(payments.map((p) => Math.abs(p.amountCents - med))) || med * 0.25;
      const mz = (0.6745 * (cur.amountCents - med)) / mad;
      if (mz >= cfg.outlierModifiedZ) {
        const established = custPayments.length >= cfg.establishedMinPayments;
        signals.push({
          rule: 'AMOUNT_OUTLIER',
          weight: established ? 0.2 : 0.6,
          reason: `${money(cur.amountCents)} is far above this shop's typical payment of ${money(med)} (robust z-score ${mz.toFixed(1)}). ${established ? 'The customer has an established history, which lowers the concern.' : 'The customer is new or has little history.'}`,
          evidenceIds: [cur.id],
        });
      }
    }

    // ---- same customer, many payments in a short window ----
    const burst = [...custPayments, cur].filter((t) => t.at > cur.at - cfg.burstWindowMs);
    if (burst.length >= cfg.burstMinCount) {
      signals.push({
        rule: 'VELOCITY_BURST',
        weight: 0.6,
        reason: `The same customer made ${burst.length} payments within ${Math.round(cfg.burstWindowMs / MIN)} minutes.`,
        evidenceIds: burst.map((t) => t.id),
      });
    }

    // ---- duplicate payment ----
    const dupes = custPayments.filter(
      (p) => p.amountCents === cur.amountCents && p.at > cur.at - cfg.duplicateWindowMs,
    );
    if (dupes.length >= 1) {
      signals.push({
        rule: 'DUPLICATE_PAYMENT',
        weight: 0.55,
        reason: `The same customer paid ${money(cur.amountCents)} again within ${Math.round(cfg.duplicateWindowMs / MIN)} minutes.`,
        evidenceIds: [...dupes.map((d) => d.id), cur.id],
      });
    }

    // ---- revenue concentration shift ----
    const last = [...payments, cur].filter((t) => t.at > cur.at - 30 * DAY);
    const prior = payments.filter((t) => t.at <= cur.at - 30 * DAY);
    const lastTotal = sum(last.map((t) => t.amountCents));
    const custLast = sum(last.filter((t) => t.customerKey === cur.customerKey).map((t) => t.amountCents));
    const priorTotal = sum(prior.map((t) => t.amountCents));
    const custPrior = sum(prior.filter((t) => t.customerKey === cur.customerKey).map((t) => t.amountCents));
    const share = lastTotal > 0 ? custLast / lastTotal : 0;
    const priorShare = priorTotal > 0 ? custPrior / priorTotal : 0;
    if (
      last.length >= cfg.concentrationMinPayments &&
      share >= cfg.concentrationShare &&
      priorShare < cfg.concentrationPriorShare
    ) {
      signals.push({
        rule: 'CONCENTRATION_SHIFT',
        weight: 0.5,
        reason: `One customer now accounts for ${(share * 100).toFixed(0)}% of the last 30 days of revenue, up from ${(priorShare * 100).toFixed(0)}% in the previous 30 days.`,
        evidenceIds: last.filter((t) => t.customerKey === cur.customerKey).map((t) => t.id),
      });
    }
  }

  if (cur.kind === 'refund') {
    const refunds = [...past, cur].filter(
      (t) => t.kind === 'refund' && t.customerKey === cur.customerKey && t.at > cur.at - 30 * DAY,
    );
    const paid = past.filter(
      (t) => t.kind === 'payment' && t.customerKey === cur.customerKey && t.at > cur.at - 30 * DAY,
    );
    const refunded = sum(refunds.map((r) => r.amountCents));
    const paidTotal = sum(paid.map((p) => p.amountCents));
    if (
      refunds.length >= cfg.refundAbuseMinRefunds &&
      paidTotal > 0 &&
      refunded >= cfg.refundAbuseRatio * paidTotal
    ) {
      signals.push({
        rule: 'REFUND_ABUSE',
        weight: refunds.length >= 3 ? 0.8 : 0.75,
        reason: `This customer has ${refunds.length} refunds in 30 days, totalling ${money(refunded)} against ${money(paidTotal)} paid.`,
        evidenceIds: [...refunds.map((r) => r.id), ...paid.map((p) => p.id)],
      });
    }

    const week = [...past, cur].filter((t) => t.kind === 'refund' && t.at > cur.at - 7 * DAY);
    const basePay = payments.filter((p) => p.at <= cur.at - 7 * DAY);
    const baseRef = past.filter(
      (t) => t.kind === 'refund' && t.at <= cur.at - 7 * DAY && t.at > cur.at - cfg.baselineDays * DAY,
    );
    const rate = Math.max(basePay.length > 0 ? baseRef.length / basePay.length : 0, 0.01);
    const weekPay = payments.filter((p) => p.at > cur.at - 7 * DAY).length;
    const expected = Math.max(rate * weekPay, 1);
    if (week.length >= cfg.refundSurgeMinCount && week.length >= cfg.refundSurgeMultiple * expected) {
      signals.push({
        rule: 'REFUND_SURGE',
        weight: 0.4,
        reason: `${week.length} refunds in 7 days against roughly ${expected.toFixed(1)} expected from the shop's normal refund rate.`,
        evidenceIds: week.map((t) => t.id),
      });
    }
  }

  if (cur.kind === 'failed') {
    const fails = [...past, cur].filter(
      (t) => t.kind === 'failed' && t.customerKey === cur.customerKey && t.at > cur.at - cfg.failedStreakWindowMs,
    );
    if (fails.length >= cfg.failedStreakMin) {
      signals.push({
        rule: 'FAILED_STREAK',
        weight: 0.65,
        reason: `${fails.length} failed payments from the same customer within ${Math.round(cfg.failedStreakWindowMs / MIN)} minutes.`,
        evidenceIds: fails.map((t) => t.id),
      });
    }
  }

  if (signals.length === 0) return null;

  // Noisy-or: independent signals reinforce each other without exceeding 1.
  const score = 1 - signals.reduce((acc, s) => acc * (1 - s.weight), 1);
  if (score < cfg.alertThreshold) return null;

  const top = [...signals].sort((a, b) => b.weight - a.weight)[0] as Signal;
  return {
    txnId: cur.id,
    at: cur.at,
    score: Number(score.toFixed(3)),
    severity: severityOf(score),
    signals,
    nextStep: NEXT_STEP[top.rule] ?? 'Review the transaction details.',
  };
}
