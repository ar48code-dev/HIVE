import { describe, expect, it } from 'vitest';
import { captureToTxn, customerKey, refundParentCaptureId, refundToTxn, toCents } from '../src/normalize.js';

describe('PayPal event normalisation', () => {
  it('converts decimal strings to integer cents without float drift', () => {
    expect(toCents('19.99')).toBe(1999);
    expect(toCents('0.30')).toBe(30);
    expect(toCents('1234.50')).toBe(123450);
  });

  it('hashes the customer and never keeps the raw value', () => {
    const k = customerKey('Buyer@Example.com');
    expect(k).toHaveLength(16);
    expect(k).not.toContain('example');
    expect(customerKey('buyer@example.com')).toBe(k); // case-insensitive
  });

  it('maps a completed capture to a payment', () => {
    const n = captureToTxn(
      'PAYMENT.CAPTURE.COMPLETED',
      {
        id: 'CAP123', amount: { value: '25.00', currency_code: 'USD' },
        seller_receivable_breakdown: { paypal_fee: { value: '1.03' } },
        create_time: '2026-11-05T10:00:00Z',
        supplementary_data: { related_ids: { order_id: 'ORD1' } },
      },
      'abc',
    );
    expect(n?.txn).toMatchObject({ id: 'pp-CAP123', kind: 'payment', amountCents: 2500, feeCents: 103, customerKey: 'abc' });
    expect(n?.orderId).toBe('ORD1');
  });

  it('maps a denied capture to a failed attempt', () => {
    const n = captureToTxn('PAYMENT.CAPTURE.DENIED', { id: 'C2', amount: { value: '5.00' }, create_time: '2026-11-05T10:00:00Z' }, 'abc');
    expect(n?.txn.kind).toBe('failed');
  });

  it('ignores event types it does not handle', () => {
    expect(captureToTxn('CHECKOUT.ORDER.APPROVED', { id: 'x', amount: { value: '1.00' } }, 'k')).toBeNull();
  });

  it('finds the parent capture of a refund', () => {
    const r = { id: 'REF1', amount: { value: '5.00' }, create_time: '2026-11-06T10:00:00Z', links: [{ rel: 'up', href: 'https://api.sandbox.paypal.com/v2/payments/captures/CAP123' }] };
    expect(refundParentCaptureId(r)).toBe('CAP123');
    expect(refundToTxn(r, 'abc', 'CAP123')?.txn).toMatchObject({ kind: 'refund', amountCents: 500 });
  });
});

import { searchDate } from '../src/paypal/client.js';
describe('Transaction Search date format', () => {
  it('strips fractional seconds, which PayPal rejects', () => {
    expect(searchDate('2026-11-05T10:00:00.123Z')).toBe('2026-11-05T10:00:00Z');
    expect(searchDate(new Date(Date.UTC(2026, 10, 5, 10, 0, 0, 999)).toISOString())).toBe('2026-11-05T10:00:00Z');
    expect(searchDate('2026-11-05T10:00:00Z')).toBe('2026-11-05T10:00:00Z');
  });
});
