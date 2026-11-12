import { createHash } from 'node:crypto';
import { config } from './config.js';
import type { Txn } from './types.js';

/** Salted hash so raw emails and payer ids never reach the database or a prompt. */
export function customerKey(raw: string): string {
  return createHash('sha256').update(`${config.CUSTOMER_HASH_SALT}:${raw.toLowerCase()}`).digest('hex').slice(0, 16);
}

export const toCents = (value: string | number): number => Math.round(Number(value) * 100);

export interface NormalizedEvent {
  txn: Txn;
  orderId?: string;
  captureId?: string;
}

/** Pure mapping from a verified PayPal webhook capture/denied resource to a Txn. Payer is resolved by the caller. */
export function captureToTxn(
  eventType: string,
  resource: any,
  payerKey: string,
): NormalizedEvent | null {
  if (eventType !== 'PAYMENT.CAPTURE.COMPLETED' && eventType !== 'PAYMENT.CAPTURE.DENIED') return null;
  if (!resource?.id || !resource?.amount?.value) return null;
  const fee = resource.seller_receivable_breakdown?.paypal_fee?.value;
  const orderId = resource.supplementary_data?.related_ids?.order_id as string | undefined;
  return {
    txn: {
      id: `pp-${resource.id}`,
      kind: eventType === 'PAYMENT.CAPTURE.DENIED' ? 'failed' : 'payment',
      amountCents: toCents(resource.amount.value),
      feeCents: fee ? toCents(fee) : 0,
      currency: resource.amount.currency_code ?? 'USD',
      customerKey: payerKey,
      at: Date.parse(resource.create_time ?? new Date().toISOString()),
      note: [resource.custom_id, resource.note_to_payer].filter(Boolean).join(' | ') || undefined,
      source: 'paypal',
    },
    orderId,
    captureId: resource.id,
  };
}

/** A refund resource links back to its capture. Returns the capture id, if present. */
export function refundParentCaptureId(resource: any): string | null {
  const up = (resource?.links ?? []).find((l: any) => l.rel === 'up')?.href as string | undefined;
  return up ? (up.split('/').pop() ?? null) : null;
}

export function refundToTxn(resource: any, payerKey: string, captureId: string | null): NormalizedEvent | null {
  if (!resource?.id || !resource?.amount?.value) return null;
  return {
    txn: {
      id: `pp-${resource.id}`,
      kind: 'refund',
      amountCents: toCents(resource.amount.value),
      feeCents: 0,
      currency: resource.amount.currency_code ?? 'USD',
      customerKey: payerKey,
      at: Date.parse(resource.create_time ?? new Date().toISOString()),
      note: resource.note_to_payer ?? undefined,
      source: 'paypal',
    },
    captureId: captureId ?? undefined,
  };
}
