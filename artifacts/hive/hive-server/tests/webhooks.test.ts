import { beforeEach, describe, expect, it, vi } from 'vitest';

// The handler's collaborators are replaced: PayPal's API, Postgres bookkeeping, and the runtime repo.
const m = vi.hoisted(() => ({
  verify: vi.fn(), getOrder: vi.fn(), getCapture: vi.fn(),
  recordEvent: vi.fn(), markProcessed: vi.fn(), findCustomerByCapture: vi.fn(),
}));
vi.mock('../src/paypal/client.js', () => ({ verifyWebhookSignature: m.verify, getOrder: m.getOrder, getCapture: m.getCapture }));
vi.mock('../src/store.js', () => ({ recordEvent: m.recordEvent, markProcessed: m.markProcessed, findCustomerByCapture: m.findCustomerByCapture }));
vi.mock('../src/runtime.js', async () => {
  const { MemoryRepo } = await import('../src/repo.js');
  return { repo: new MemoryRepo(), demoMode: false };
});

import { ingestCapturedOrder, webhookHandler } from '../src/webhooks.js';
import { customerKey } from '../src/normalize.js';
import { repo } from '../src/runtime.js';

function call(event: unknown) {
  const req: any = { body: Buffer.from(JSON.stringify(event)), headers: {} };
  const out: { status: number; body: any } = { status: 0, body: null };
  const res: any = { status(c: number) { out.status = c; return this; }, json(b: unknown) { out.body = b; return this; } };
  return webhookHandler(req, res).then(() => out);
}

const capture = (id = 'CAP1', order = 'ORD1') => ({
  id: `EV-${id}`, event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: { id, amount: { value: '25.00', currency_code: 'USD' }, seller_receivable_breakdown: { paypal_fee: { value: '1.03' } }, create_time: '2026-11-05T10:00:00Z', supplementary_data: { related_ids: { order_id: order } } },
});
const refund = (id = 'REF1', cap = 'CAP1') => ({
  id: `EV-${id}`, event_type: 'PAYMENT.CAPTURE.REFUNDED',
  resource: { id, amount: { value: '10.00', currency_code: 'USD' }, create_time: '2026-11-05T11:00:00Z', links: [{ rel: 'up', href: `https://api.sandbox.paypal.com/v2/payments/captures/${cap}` }] },
});

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.verify.mockResolvedValue(true);
  m.recordEvent.mockResolvedValue('new');
  m.markProcessed.mockResolvedValue(undefined);
  m.findCustomerByCapture.mockResolvedValue(null);
  m.getOrder.mockResolvedValue({ payer: { payer_id: 'PAYER1' } });
});

describe('PayPal webhook handler', () => {
  it('records a buyer-approved HIVE Sandbox capture immediately and deduplicates its later webhook', async () => {
    const orderId = 'ORDER-LIVE-1';
    const captured = {
      id: orderId,
      status: 'COMPLETED',
      purchase_units: [{
        custom_id: 'hive-demo',
        payments: { captures: [{ id: 'CAPTURE-LIVE-1', status: 'COMPLETED', amount: { value: '1.00', currency_code: 'USD' }, create_time: '2026-11-12T12:00:00Z' }] },
      }],
    };
    const first = await ingestCapturedOrder(orderId, captured);
    const again = await ingestCapturedOrder(orderId, captured);
    const t = (await repo.listTxns(0)).find((x) => x.id === 'pp-CAPTURE-LIVE-1')!;
    expect(first).toMatchObject({ status: 'COMPLETED', recorded: true, duplicate: false, orderId, captureId: 'CAPTURE-LIVE-1', amount: '1.00', currency: 'USD' });
    expect(again).toMatchObject({ recorded: true, duplicate: true });
    expect(t.customerKey).toBe(customerKey('PAYER1'));
    expect(t.source).toBe('paypal');

    const event = capture('CAPTURE-LIVE-1', orderId);
    const webhook = await call(event);
    expect(webhook.status).toBe(200);
    expect((await repo.listTxns(0)).filter((x) => x.id === 'pp-CAPTURE-LIVE-1')).toHaveLength(1);
  });

  it('does not import non-HIVE orders or incomplete captures as HIVE payments', async () => {
    await expect(ingestCapturedOrder('ORDER-OTHER', {
      status: 'COMPLETED',
      purchase_units: [{ custom_id: 'other-app', payments: { captures: [{ id: 'CAP-OTHER', status: 'COMPLETED', amount: { value: '1.00', currency_code: 'USD' } }] } }],
    })).rejects.toThrow(/HIVE capture details could not be verified/);
    await expect(ingestCapturedOrder('ORDER-PENDING', {
      status: 'APPROVED',
      purchase_units: [{ custom_id: 'hive-demo', payments: { captures: [] } }],
    })).resolves.toMatchObject({ status: 'APPROVED', recorded: false });
    expect((await repo.listTxns(0)).some((t) => t.id === 'pp-CAP-OTHER')).toBe(false);
  });

  it('rejects unverified events and stores nothing', async () => {
    m.verify.mockResolvedValue(false);
    const r = await call(capture('CAPX'));
    expect(r.status).toBe(401);
    expect(m.recordEvent).not.toHaveBeenCalled();
    expect(await repo.listTxns(0)).not.toContainEqual(expect.objectContaining({ id: 'pp-CAPX' }));
  });

  it('stores a verified capture against the real payer, hashed', async () => {
    const r = await call(capture('CAP1'));
    expect(r.status).toBe(200);
    const t = (await repo.listTxns(0)).find((x) => x.id === 'pp-CAP1')!;
    expect(t.customerKey).toBe(customerKey('PAYER1'));
    expect(t.amountCents).toBe(2500);
    expect(m.markProcessed).toHaveBeenCalledWith('EV-CAP1');
  });

  it('acknowledges a duplicate delivery without reprocessing', async () => {
    m.recordEvent.mockResolvedValue('duplicate_done');
    const r = await call(capture('CAP2'));
    expect(r.body).toEqual({ duplicate: true });
    expect(m.getOrder).not.toHaveBeenCalled();
  });

  it('reprocesses an event that was recorded but never finished', async () => {
    m.recordEvent.mockResolvedValue('duplicate_pending');
    const r = await call(capture('CAP3'));
    expect(r.status).toBe(200);
    expect(m.markProcessed).toHaveBeenCalledWith('EV-CAP3');
  });

  it('returns 500 so PayPal retries when the payer cannot be resolved, instead of inventing a customer', async () => {
    m.getOrder.mockRejectedValue(new Error('network down'));
    const r = await call(capture('CAP4'));
    expect(r.status).toBe(500);
    expect(m.markProcessed).not.toHaveBeenCalled();
    expect((await repo.listTxns(0)).some((x) => x.id === 'pp-CAP4')).toBe(false);
  });

  it('returns 500 when the order has no payer yet', async () => {
    m.getOrder.mockResolvedValue({});
    expect((await call(capture('CAP5'))).status).toBe(500);
  });

  it('ignores event types it does not handle, but marks them processed', async () => {
    const r = await call({ id: 'EV-X', event_type: 'CUSTOMER.DISPUTE.CREATED', resource: {} });
    expect(r.body).toEqual({ ignored: 'CUSTOMER.DISPUTE.CREATED' });
    expect(m.markProcessed).toHaveBeenCalledWith('EV-X');
  });

  it('ties a refund to the payer using the stored capture, with no extra API call', async () => {
    m.findCustomerByCapture.mockResolvedValue(customerKey('PAYER1'));
    const r = await call(refund('REF1', 'CAP1'));
    expect(r.status).toBe(200);
    expect(m.getCapture).not.toHaveBeenCalled();
    const t = (await repo.listTxns(0)).find((x) => x.id === 'pp-REF1')!;
    expect(t.kind).toBe('refund');
    expect(t.customerKey).toBe(customerKey('PAYER1'));
  });

  it('handles a refund that arrives before its payment by asking PayPal who paid', async () => {
    m.getCapture.mockResolvedValue({ supplementary_data: { related_ids: { order_id: 'ORD9' } } });
    m.getOrder.mockResolvedValue({ payer: { payer_id: 'PAYER9' } });
    const r = await call(refund('REF9', 'CAP9'));
    expect(r.status).toBe(200);
    expect(m.getCapture).toHaveBeenCalledWith('CAP9');
    const t = (await repo.listTxns(0)).find((x) => x.id === 'pp-REF9')!;
    expect(t.customerKey).toBe(customerKey('PAYER9'));
  });

  it('rejects malformed JSON', async () => {
    const req: any = { body: Buffer.from('{not json'), headers: {} };
    const out: any = {};
    const res: any = { status(c: number) { out.status = c; return this; }, json() { return this; } };
    await webhookHandler(req, res);
    expect(out.status).toBe(400);
  });
});
