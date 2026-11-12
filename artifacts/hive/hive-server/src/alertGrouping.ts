import { HOUR } from './risk/engine.js';
import type { Alert, Severity, Signal } from './types.js';

export const GROUP_WINDOW_MS = 45 * 60_000; // look-alike alerts within 45 minutes are one burst

export const topRule = (a: Pick<Alert, 'signals'>): string =>
  ([...a.signals].sort((x, y) => y.weight - x.weight)[0] as Signal).rule;

export const severityOf = (score: number): Severity => (score >= 0.85 ? 'high' : score >= 0.6 ? 'medium' : 'low');

/** Is this new alert part of an alert that is already open (shared evidence, or same rule close in time)? */
/** Rules that describe the whole shop, not one incident. Their evidence is broad and shared by many incidents. */
const MERCHANT_WIDE = new Set(['REFUND_SURGE']);

/** Evidence that pins an alert to one incident. Merchant-wide evidence only counts when it is all there is. */
const coreEvidence = (signals: Signal[]): Set<string> => {
  const specific = signals.filter((s) => !MERCHANT_WIDE.has(s.rule));
  return new Set((specific.length ? specific : signals).flatMap((s) => s.evidenceIds));
};

export function sameGroup(existing: Alert & { status?: string }, incoming: Alert): boolean {
  if ((existing.status ?? 'open') !== 'open') return false;
  // A surge-only alert is "more refunds than usual". It folds into an open incident that already explains
  // at least half of those refunds, so one story does not become two alerts.
  if (incoming.signals.every((s) => MERCHANT_WIDE.has(s.rule))) {
    const all = new Set(existing.signals.flatMap((s) => s.evidenceIds));
    const ids = [...new Set(incoming.signals.flatMap((s) => s.evidenceIds))];
    if (ids.filter((id) => all.has(id)).length / ids.length >= 0.5) return true;
  }
  // Same incident when at least half of the smaller alert's incident evidence is shared.
  const have = coreEvidence(existing.signals);
  const mine = coreEvidence(incoming.signals);
  const shared = [...mine].filter((id) => have.has(id)).length;
  if (shared > 0 && shared / Math.min(have.size, mine.size) >= 0.5) return true;
  // Otherwise: same leading rule, close in time (a burst of look-alike alerts).
  return topRule(existing) === topRule(incoming) && Math.abs(incoming.at - existing.at) < GROUP_WINDOW_MS;
}

/** Fold a later alert into an earlier one so one incident is one alert, with the widest evidence. */
export function mergeAlerts(existing: Alert, incoming: Alert): Alert {
  const byRule = new Map<string, Signal>(existing.signals.map((s) => [s.rule, s]));
  for (const s of incoming.signals) {
    const cur = byRule.get(s.rule);
    if (!cur || s.evidenceIds.length >= cur.evidenceIds.length) byRule.set(s.rule, s);
  }
  const signals = [...byRule.values()];
  const score = Number((1 - signals.reduce((acc, s) => acc * (1 - s.weight), 1)).toFixed(3));
  return { ...existing, signals, score, severity: severityOf(score) };
}
