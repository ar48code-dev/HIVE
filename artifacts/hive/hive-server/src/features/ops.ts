import { alias, } from '../analytics.js';
import { config, demoMode } from '../config.js';
import { sanitizeUntrusted } from '../ai/sanitize.js';
import { detectRecurring } from '../recurring.js';
import type { Repo, StoredOp, StoredAlert } from '../repo.js';
import type { Txn } from '../types.js';

const DAY = 86_400_000;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[A-Za-z]{2,}$/;
export const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, '$1***$2');

/* ============================== Disputes ============================== */

export interface Dispute {
  id: string; reason: string; amountCents: number; currency: string; status: string;
  customer: string; txnId?: string; openedAt: number; respondBy: number; simulated: boolean;
}
const REASONS = ['MERCHANDISE_OR_SERVICE_NOT_RECEIVED', 'UNAUTHORISED', 'DUPLICATE_TRANSACTION'] as const;

/** Demo mode: three realistic disputes built from real rows in the synthetic history, so the evidence is real too. */
function syntheticDisputes(txns: Txn[], asOf: number): Dispute[] {
  const pays = txns.filter((t) => t.kind === 'payment' && t.at < asOf - 2 * DAY && t.at > asOf - 28 * DAY).sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Set<string>(); const out: Dispute[] = [];
  for (const t of pays) {
    if (seen.has(t.customerKey) || t.amountCents < 1500) continue; seen.add(t.customerKey);
    const i = out.length; if (i >= 3) break;
    out.push({ id: `PP-D-SYN-${String(1001 + i)}`, reason: REASONS[i]!, amountCents: t.amountCents, currency: t.currency, status: 'WAITING_FOR_SELLER_RESPONSE',
      customer: alias(t.customerKey), txnId: t.id, openedAt: t.at + 3 * DAY, respondBy: t.at + 3 * DAY + 10 * DAY, simulated: true });
  }
  return out;
}

export async function listDisputeCases(repo: Repo): Promise<{ items: Array<Dispute & { response?: StoredOp }>; live: boolean }> {
  const ops = await repo.listOps('dispute_response');
  const byKey = new Map(ops.map((o) => [o.key, o]));
  let items: Dispute[];
  if (demoMode) {
    const txns = await repo.listTxns(0); const asOf = txns.reduce((m, t) => Math.max(m, t.at), 0) || Date.now();
    items = syntheticDisputes(txns, asOf);
  } else {
    const { listDisputes } = await import('../paypal/client.js');
    const r = await listDisputes();
    items = (r?.items ?? []).map((d: any): Dispute => ({
      id: String(d.dispute_id), reason: String(d.reason ?? 'OTHER'), amountCents: Math.round(Number(d.dispute_amount?.value ?? 0) * 100), currency: String(d.dispute_amount?.currency_code ?? 'USD'),
      status: String(d.status ?? ''), customer: 'PayPal buyer', txnId: d.disputed_transactions?.[0]?.seller_transaction_id ? `pp-${d.disputed_transactions[0].seller_transaction_id}` : undefined,
      openedAt: Date.parse(d.create_time) || Date.now(), respondBy: Date.parse(d.seller_response_due_date) || Date.now() + 10 * DAY, simulated: false,
    }));
  }
  return { items: items.map((d) => ({ ...d, response: byKey.get(d.id) })), live: !demoMode };
}

/** Assemble the evidence note from facts in the database. No model writes facts here. */
export async function prepareDisputeResponse(repo: Repo, d: Dispute): Promise<StoredOp> {
  const all = await repo.listTxns(0);
  const txn = d.txnId ? all.find((t) => t.id === d.txnId) : undefined;
  const key = txn?.customerKey;
  const mine = key ? all.filter((t) => t.customerKey === key) : [];
  const payments = mine.filter((t) => t.kind === 'payment').sort((a, b) => a.at - b.at);
  const refunds = mine.filter((t) => t.kind === 'refund');
  const alerts = (await repo.listAlerts()).filter((a: StoredAlert) => a.signals.some((s) => s.evidenceIds.some((id) => mine.some((t) => t.id === id))));
  const before = txn ? payments.filter((t) => t.at < txn.at) : [];
  const dupAlert = alerts.find((a) => a.signals.some((s) => s.rule === 'DUPLICATE_PAYMENT'));
  let recommendation: 'contest' | 'accept' = 'contest'; let why = 'The payer has a normal history with this seller.';
  if (d.reason === 'DUPLICATE_TRANSACTION' && dupAlert) { recommendation = 'accept'; why = 'HIVE had already flagged this payer as a duplicate payment, so the buyer is likely right. Consider accepting and refunding.'; }
  else if (before.length === 0) { why = 'This payer has no earlier payments, so there is little history to rely on. Review carefully before contesting.'; }
  const notes = [
    `Seller response for dispute ${d.id} (${d.reason.replace(/_/g, ' ').toLowerCase()}).`,
    txn ? `Disputed payment: ${money(txn.amountCents)} on ${iso(txn.at)} (transaction ${txn.id}).` : 'The disputed payment could not be matched to a stored transaction.',
    key ? `Payer history with this seller: ${payments.length} payments totalling ${money(payments.reduce((s, t) => s + t.amountCents, 0))}, first on ${iso(payments[0]!.at)}; ${before.length} before the disputed payment; ${refunds.length} refunds.` : '',
    alerts.length ? `Fraud signals on record for this payer: ${alerts.map((a) => `#${a.id} ${a.severity}`).join(', ')}.` : 'No fraud alerts on record for this payer.',
    'Prepared from transaction records by HIVE. The seller reviewed and approved this response before it was sent.',
  ].filter(Boolean).join('\n');
  return repo.createOp('dispute_response', { disputeId: d.id, reason: d.reason, amountCents: d.amountCents, currency: d.currency, customer: d.customer, txnId: d.txnId, recommendation, why, notes, simulated: d.simulated }, d.id);
}

/* ============================== Payouts ============================== */

export function payoutUsedCents(ops: StoredOp[], now = Date.now()): number {
  return ops.filter((o) => o.kind === 'payout' && o.status === 'executed' && (o.decidedAt ?? 0) > now - DAY).reduce((s, o) => s + Number(o.payload.amountCents ?? 0), 0);
}
export interface PayoutInput { email?: unknown; amount?: unknown; note?: unknown }
export function validatePayout(i: PayoutInput): { ok: true; email: string; amountCents: number; note: string } | { ok: false; error: string } {
  const email = String(i.email ?? '').trim();
  if (!EMAIL.test(email)) return { ok: false, error: 'Enter a valid recipient email address.' };
  const n = Number(i.amount);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Enter an amount greater than zero.' };
  const amountCents = Math.round(n * 100);
  if (amountCents > config.PAYOUT_DAILY_CAP_CENTS) return { ok: false, error: `That is above the daily cap of ${money(config.PAYOUT_DAILY_CAP_CENTS)}.` };
  const note = sanitizeUntrusted(String(i.note ?? ''), 150).text;
  if (!note) return { ok: false, error: 'Add a short note saying what the payout is for.' };
  return { ok: true, email, amountCents, note };
}

/* ============================== Invoices ============================== */

export interface InvoiceInput { customer?: unknown; email?: unknown; amount?: unknown; description?: unknown; dueDays?: unknown }
export function validateInvoice(i: InvoiceInput): { ok: true; customer: string; email: string; amountCents: number; description: string; dueDays: number } | { ok: false; error: string } {
  const email = String(i.email ?? '').trim();
  if (!EMAIL.test(email)) return { ok: false, error: 'Enter the customer’s billing email. HIVE only stores anonymous aliases, so you provide it.' };
  const n = Number(i.amount); if (!Number.isFinite(n) || n <= 0 || n > 100_000) return { ok: false, error: 'Enter an amount between $0.01 and $100,000.' };
  const description = sanitizeUntrusted(String(i.description ?? ''), 120).text; if (!description) return { ok: false, error: 'Add a short description for the invoice.' };
  const d = Number(i.dueDays ?? 10); const dueDays = Number.isFinite(d) ? Math.min(60, Math.max(1, Math.round(d))) : 10;
  return { ok: true, customer: sanitizeUntrusted(String(i.customer ?? ''), 20).text, email, amountCents: Math.round(n * 100), description, dueDays };
}

/** Repeat customers whose expected payment is late: the natural people to invoice. */
export async function invoiceSuggestions(repo: Repo) {
  const txns = await repo.listTxns(0); const asOf = txns.reduce((m, t) => Math.max(m, t.at), 0) || Date.now();
  return detectRecurring(txns, asOf).filter((r) => r.overdue).map((r) => ({ customer: r.customer, typicalCents: r.typicalCents, daysLate: Math.max(1, -r.daysUntil), confidence: r.confidence }));
}

/* ============================== Execution ============================== */

export interface OpResult { ok: boolean; simulated: boolean; detail: Record<string, unknown> }

/** Run an approved op. In demo mode (or for synthetic disputes) nothing leaves the machine. */
export async function executeOp(op: StoredOp, repo: Repo): Promise<OpResult> {
  const p = op.payload as Record<string, any>;
  if (op.kind === 'dispute_response') {
    if (demoMode || p.simulated) return { ok: true, simulated: true, detail: { message: 'Simulated. Nothing was sent to PayPal.', disputeId: p.disputeId } };
    const { provideEvidence } = await import('../paypal/client.js');
    await provideEvidence(String(p.disputeId), String(p.notes));
    return { ok: true, simulated: false, detail: { disputeId: p.disputeId, sentToPayPal: true } };
  }
  if (op.kind === 'payout') {
    const used = payoutUsedCents(await repo.listOps('payout'));
    if (used + Number(p.amountCents) > config.PAYOUT_DAILY_CAP_CENTS) throw new Error(`This would pass the daily cap of ${money(config.PAYOUT_DAILY_CAP_CENTS)} (already paid ${money(used)} in the last 24 hours).`);
    if (demoMode) return { ok: true, simulated: true, detail: { message: 'Simulated. No money moved.', amount: money(Number(p.amountCents)), to: maskEmail(String(p.email)) } };
    const { createPayout } = await import('../paypal/client.js');
    const out = await createPayout(String(p.email), (Number(p.amountCents) / 100).toFixed(2), String(p.currency ?? 'USD'), String(p.note), `hive-op-${op.id}`);
    return { ok: true, simulated: false, detail: { batchId: out?.batch_header?.payout_batch_id, status: out?.batch_header?.batch_status } };
  }
  // invoice: approval creates a DRAFT. Sending is a second, separate confirmation.
  if (demoMode) return { ok: true, simulated: true, detail: { message: 'Simulated draft. Nothing was created in PayPal.', invoiceId: `INV-SIM-${op.id}`, draft: true } };
  const { createInvoiceDraft } = await import('../paypal/client.js');
  const d = await createInvoiceDraft(String(p.email), (Number(p.amountCents) / 100).toFixed(2), String(p.currency ?? 'USD'), String(p.description), Number(p.dueDays ?? 10));
  return { ok: true, simulated: false, detail: { invoiceId: d.id, draft: true } };
}

export async function sendInvoiceOp(op: StoredOp): Promise<OpResult> {
  if (op.kind !== 'invoice' || op.status !== 'executed') throw new Error('Only an approved invoice draft can be sent.');
  if (op.result?.sent) throw new Error('This invoice was already sent.');
  if (demoMode || op.result?.simulated) return { ok: true, simulated: true, detail: { sent: true, message: 'Simulated. Nothing was emailed.' } };
  const { sendInvoice } = await import('../paypal/client.js');
  await sendInvoice(String(op.result?.invoiceId));
  return { ok: true, simulated: false, detail: { sent: true } };
}
