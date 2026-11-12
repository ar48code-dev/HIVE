import { demoMode } from './config.js';
import { alias } from './analytics.js';
import type { Repo, StoredAction, StoredAlert } from './repo.js';
import type { Txn } from './types.js';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

export function buildEvidencePacket(alert: StoredAlert, txns: Txn[]): string {
  const byId = new Map(txns.map((t) => [t.id, t]));
  const ids = [...new Set(alert.signals.flatMap((s) => s.evidenceIds))];
  const lines = [
    `HIVE evidence packet for alert #${alert.id}`,
    `Severity: ${alert.severity}   Score: ${alert.score}`,
    `Prepared: ${iso(Date.now())}`,
    '',
    'What was detected',
    ...alert.signals.map((s) => `- ${s.rule}: ${s.reason}`),
    '',
    'Transactions involved (timeline)',
    ...ids
      .map((i) => byId.get(i))
      .filter((t): t is Txn => !!t)
      .sort((a, b) => a.at - b.at)
      .map((t) => `- ${iso(t.at)}  ${t.kind.padEnd(7)} ${money(t.amountCents).padStart(10)}  ${alias(t.customerKey)}  id=${t.id}`),
    '',
    'Suggested next step',
    alert.nextStep,
    '',
    'Note: this packet was generated from transaction data by an automated risk engine. It is a summary to support your own review, not a finding of fraud.',
  ];
  return lines.join('\n');
}

/** Propose actions for an alert. Nothing here moves money; proposals wait for a human decision. */
export async function proposeActions(repo: Repo, alert: StoredAlert) {
  const ids = [...new Set(alert.signals.flatMap((s) => s.evidenceIds))];
  const txns = await repo.getTxns(ids);

  const dup = alert.signals.find((s) => s.rule === 'DUPLICATE_PAYMENT');
  if (dup) {
    const dupTxns = txns.filter((t) => dup.evidenceIds.includes(t.id) && t.kind === 'payment').sort((a, b) => a.at - b.at);
    const later = dupTxns[dupTxns.length - 1];
    if (later && dupTxns.length >= 2) {
      await repo.createAction(alert.id, 'refund_draft', {
        txnId: later.id,
        captureId: later.id.replace(/^(pp|syn)-/, ''),
        amountCents: later.amountCents,
        currency: later.currency,
        summary: `Refund the second ${money(later.amountCents)} payment from ${alias(later.customerKey)}`,
        reason: 'Same customer paid the same amount twice within two minutes.',
        simulated: later.source === 'synthetic',
      });
    }
  }
  await repo.createAction(alert.id, 'evidence_packet', {
    summary: 'Export an evidence packet for your records or a dispute',
    text: buildEvidencePacket(alert, txns),
  });
}

export interface ExecResult { ok: boolean; simulated: boolean; detail: Record<string, unknown> }

/** Run an approved action. Real refunds only happen for real PayPal captures outside demo mode. */
export async function executeAction(action: StoredAction): Promise<ExecResult> {
  if (action.type === 'evidence_packet') return { ok: true, simulated: false, detail: { exported: true } };

  const p = action.payload as { captureId: string; amountCents: number; currency: string; simulated?: boolean };
  if (demoMode || p.simulated) {
    return { ok: true, simulated: true, detail: { message: 'Simulated. No money moved.', amount: money(p.amountCents) } };
  }
  const { refundCapture } = await import('./paypal/client.js');
  const out = await refundCapture(p.captureId, (p.amountCents / 100).toFixed(2), p.currency, `hive-action-${action.id}`, 'Duplicate payment refunded');
  return { ok: true, simulated: false, detail: { refundId: out?.id, status: out?.status } };
}
