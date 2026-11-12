import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

/*
 * Thin PayPal REST client (sandbox). The OAuth and checkout paths are verified
 * against the Sandbox; reporting, payouts, disputes and invoices require separate checks.
 */

let cached: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const basic = Buffer.from(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${config.PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal token request failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

async function api<T>(path: string, init: RequestInit & { requestId?: string } = {}, attempt = 0): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(init.requestId ? { 'PayPal-Request-Id': init.requestId } : {}),
  };
  const res = await fetch(`${config.PAYPAL_BASE_URL}${path}`, { ...init, headers });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    return api<T>(path, init, attempt + 1);
  }
  if (!res.ok) throw new Error(`PayPal ${init.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export interface CreatedOrder { id: string; status: string; links: Array<{ rel: string; href: string }> }

/** Create a CAPTURE order. Pass a stable requestId so retries cannot create duplicates. */
export function createOrder(amount: string, currency = 'USD', customId?: string, requestId: string = randomUUID()) {
  return api<CreatedOrder>('/v2/checkout/orders', {
    method: 'POST',
    requestId,
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: currency, value: amount }, ...(customId ? { custom_id: customId } : {}) }],
    }),
  });
}

export function captureOrder(orderId: string, requestId: string = `capture-${orderId}`) {
  return api<any>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', requestId, body: '{}' });
}

/** Fetch a capture so a refund that arrives before its payment can still be tied to the payer. */
export function getCapture(captureId: string) {
  return api<any>(`/v2/payments/captures/${encodeURIComponent(captureId)}`);
}

export function getOrder(orderId: string) {
  return api<any>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

/** Verify a webhook with PayPal's own verification endpoint. Returns false on any failure. */
export async function verifyWebhookSignature(headers: Record<string, string | string[] | undefined>, event: unknown): Promise<boolean> {
  const h = (k: string) => {
    const v = headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  try {
    const out = await api<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: JSON.stringify({
        auth_algo: h('paypal-auth-algo'),
        cert_url: h('paypal-cert-url'),
        transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'),
        transmission_time: h('paypal-transmission-time'),
        webhook_id: config.HIVE_PAYPAL_WEBHOOK_ID,
        webhook_event: event,
      }),
    });
    return out.verification_status === 'SUCCESS';
  } catch (err) {
    console.error('webhook verification error', err);
    return false;
  }
}

/** Transaction Search (reporting). Can lag by hours and needs the feature enabled on the app. */
/** Transaction Search rejects fractional seconds, so `2026-11-05T10:00:00.123Z` must become `2026-11-05T10:00:00Z`. */
export const searchDate = (iso: string): string => iso.replace(/\.\d+(?=Z$)/, '');

export async function searchTransactions(startIso: string, endIso: string, page = 1) {
  const q = new URLSearchParams({ start_date: searchDate(startIso), end_date: searchDate(endIso), fields: 'all', page_size: '100', page: String(page) });
  return api<any>(`/v1/reporting/transactions?${q.toString()}`);
}

/** Refund a captured payment. Idempotent through the request id. Used only after a human approves. */
export function refundCapture(captureId: string, amount: string, currency: string, requestId: string, note?: string) {
  return api<any>(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    method: 'POST',
    requestId,
    body: JSON.stringify({ amount: { value: amount, currency_code: currency }, ...(note ? { note_to_payer: note.slice(0, 255) } : {}) }),
  });
}

/* ---- Disputes, Payouts, Invoicing. Field names follow the public PayPal REST docs; run each once in the sandbox and check the response. ---- */

export function listDisputes() {
  return api<any>('/v1/customer/disputes?page_size=20');
}

/** Send the seller's evidence note for a dispute. Used only after a human approves. */
export function provideEvidence(disputeId: string, notes: string) {
  return api<any>(`/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`, {
    method: 'POST',
    body: JSON.stringify({ evidences: [{ evidence_type: 'OTHER', notes: notes.slice(0, 2000) }] }),
  });
}

/** One-recipient payout. The batch id makes a retry safe: PayPal rejects a repeated sender_batch_id. */
export function createPayout(email: string, amount: string, currency: string, note: string, batchId: string) {
  return api<any>('/v1/payments/payouts', {
    method: 'POST',
    requestId: batchId,
    body: JSON.stringify({
      sender_batch_header: { sender_batch_id: batchId, email_subject: 'You have a payment', email_message: note.slice(0, 200) },
      items: [{ recipient_type: 'EMAIL', amount: { value: amount, currency }, receiver: email, note: note.slice(0, 200), sender_item_id: batchId }],
    }),
  });
}

/** Create a DRAFT invoice. Nothing is sent to the customer until sendInvoice is called. */
export async function createInvoiceDraft(email: string, amount: string, currency: string, description: string, dueDays: number) {
  const day = new Date().toISOString().slice(0, 10);
  const out = await api<any>('/v2/invoicing/invoices', {
    method: 'POST',
    body: JSON.stringify({
      detail: { currency_code: currency, invoice_date: day, payment_term: { term_type: 'NET_10', due_date: new Date(Date.now() + dueDays * 86_400_000).toISOString().slice(0, 10) }, note: description.slice(0, 200) },
      primary_recipients: [{ billing_info: { email_address: email } }],
      items: [{ name: description.slice(0, 100) || 'Services', quantity: '1', unit_amount: { currency_code: currency, value: amount } }],
    }),
  });
  const id = String(out?.href ?? '').split('/').pop() ?? '';
  return { id, href: out?.href as string | undefined };
}

export function sendInvoice(invoiceId: string) {
  return api<any>(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`, { method: 'POST', body: JSON.stringify({ send_to_recipient: true, send_to_invoicer: false }) });
}
