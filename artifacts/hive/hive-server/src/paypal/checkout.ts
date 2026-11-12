const ALLOWED_AMOUNTS = new Set(['1.00', '5.00', '25.00', '120.00']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CheckoutCreateInput {
  amount: string;
  requestId: string;
}

/** HIVE checkout is a fixed Sandbox catalogue and requires a retry-stable PayPal request id. */
export function parseCheckoutCreateInput(body: unknown): CheckoutCreateInput | null {
  if (!body || typeof body !== 'object') return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.amount !== 'string' || !ALLOWED_AMOUNTS.has(candidate.amount)) return null;
  if (typeof candidate.requestId !== 'string' || !UUID.test(candidate.requestId)) return null;
  return { amount: candidate.amount, requestId: candidate.requestId };
}
