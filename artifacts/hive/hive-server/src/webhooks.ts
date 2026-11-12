import type { Request, Response } from 'express';
import { DAY, evaluate } from './risk/engine.js';
import { verifyWebhookSignature, getOrder, getCapture } from './paypal/client.js';
import { captureToTxn, customerKey, refundParentCaptureId, refundToTxn, type NormalizedEvent } from './normalize.js';
import * as store from './store.js';
import { repo, demoMode } from './runtime.js';
import { proposeActions } from './actions.js';
import { notifyAlert } from './notify.js';

const HANDLED = new Set([
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.CAPTURE.REVERSED',
]);

/**
 * Resolve the payer behind an order. If the lookup fails we THROW, so the webhook returns 500 and PayPal retries.
 * Guessing a customer here would turn every payer into a stranger and silently break the customer-based rules.
 */
async function payerKeyForOrder(orderId?: string, fallback = 'unknown'): Promise<string> {
  if (!orderId) return customerKey(fallback);
  const order = await getOrder(orderId);
  const raw = order?.payer?.payer_id ?? order?.payer?.email_address;
  if (!raw) throw new Error(`order ${orderId} has no payer yet`);
  return customerKey(String(raw));
}

async function normalize(event: any): Promise<NormalizedEvent | null> {
  const type: string = event.event_type;
  const resource = event.resource;
  if (type === 'PAYMENT.CAPTURE.COMPLETED' || type === 'PAYMENT.CAPTURE.DENIED') {
    const orderId = resource?.supplementary_data?.related_ids?.order_id;
    return captureToTxn(type, resource, await payerKeyForOrder(orderId, resource?.id));
  }
  if (type === 'PAYMENT.CAPTURE.REFUNDED' || type === 'PAYMENT.CAPTURE.REVERSED') {
    const captureId = refundParentCaptureId(resource);
    let key = captureId ? await store.findCustomerByCapture(captureId) : null;
    if (!key && captureId) {
      // The refund arrived before its payment (out of order). Ask PayPal who paid, rather than inventing a customer.
      const cap = await getCapture(captureId);
      key = await payerKeyForOrder(cap?.supplementary_data?.related_ids?.order_id, captureId);
    }
    return refundToTxn(resource, key ?? customerKey(captureId ?? resource?.id ?? 'unknown'), captureId);
  }
  return null;
}

async function persistNormalized(n: NormalizedEvent): Promise<boolean> {
  const inserted = await repo.upsertTxn(n.txn, { orderId: n.orderId, captureId: n.captureId });
  if (!inserted) return false;
  const history = await repo.listTxns(n.txn.at - 60 * DAY);
  const alert = evaluate(history, n.txn);
  if (alert) {
    const stored = await repo.saveAlert(alert);
    await proposeActions(repo, stored);
    void notifyAlert(stored);
    await repo.audit('system', 'alert_created', { alertId: stored.id, txnId: alert.txnId, score: alert.score, rules: alert.signals.map((s) => s.rule) });
  }
  return true;
}

/**
 * Persist a capture returned directly by HIVE's own PayPal checkout. The later
 * signed webhook is still verified, then safely deduplicated by capture id.
 */
export async function ingestCapturedOrder(orderId: string, order: any) {
  if (order?.status !== 'COMPLETED') {
    return { status: String(order?.status ?? 'UNKNOWN'), recorded: false, orderId };
  }
  const unit = (order.purchase_units ?? []).find((u: any) => u.custom_id === 'hive-demo');
  const capture = unit?.payments?.captures?.find((c: any) => c.status === 'COMPLETED');
  if (!unit || !capture?.id || !capture.amount?.value) {
    throw new Error('PayPal completed the order, but its HIVE capture details could not be verified.');
  }
  if (capture.amount.currency_code !== 'USD') {
    throw new Error('HIVE accepts USD Sandbox captures only.');
  }
  const payerKey = await payerKeyForOrder(orderId);
  const n = captureToTxn('PAYMENT.CAPTURE.COMPLETED', {
    ...capture,
    supplementary_data: {
      ...capture.supplementary_data,
      related_ids: { ...capture.supplementary_data?.related_ids, order_id: orderId },
    },
  }, payerKey);
  if (!n) throw new Error('PayPal completed the order, but its capture could not be normalized.');
  const inserted = await persistNormalized(n);
  if (inserted) {
    await repo.audit('system', 'checkout_capture_recorded', { orderId, captureId: n.captureId });
  }
  return {
    status: 'COMPLETED',
    recorded: true,
    duplicate: !inserted,
    orderId,
    captureId: n.captureId,
    amount: capture.amount.value,
    currency: capture.amount.currency_code,
    transactionId: n.txn.id,
  };
}

export async function webhookHandler(req: Request, res: Response) {
  if (demoMode) return res.status(503).json({ error: 'demo mode: webhooks are disabled' });
  let event: any;
  try {
    event = JSON.parse((req.body as Buffer).toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid json' });
  }

  // 1. Authenticity first. Unverified events are never stored or processed.
  if (!(await verifyWebhookSignature(req.headers, event))) {
    return res.status(401).json({ error: 'signature verification failed' });
  }

  try {
    // 2. Idempotency: PayPal retries and may deliver duplicates or out of order.
    const state = await store.recordEvent(event.id, event.event_type, event);
    if (state === 'duplicate_done') return res.status(200).json({ duplicate: true });
    if (!HANDLED.has(event.event_type)) {
      await store.markProcessed(event.id);
      return res.status(200).json({ ignored: event.event_type });
    }

    // 3. Normalise, store, evaluate, alert.
    const n = await normalize(event);
    if (n) await persistNormalized(n);
    await store.markProcessed(event.id);
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('webhook processing failed', err);
    // Non-2xx makes PayPal retry. The event is recorded but unprocessed, so the retry will run again.
    return res.status(500).json({ error: 'processing failed' });
  }
}
