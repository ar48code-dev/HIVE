import { describe, expect, it } from 'vitest';
import { parseCheckoutCreateInput } from '../src/paypal/checkout.js';

describe('PayPal checkout request validation', () => {
  it('accepts only HIVE catalogue amounts and stable UUID retry ids', () => {
    expect(parseCheckoutCreateInput({ amount: '1.00', requestId: 'f11dfba2-e371-4b3a-8446-a6b7339c2b7f' }))
      .toEqual({ amount: '1.00', requestId: 'f11dfba2-e371-4b3a-8446-a6b7339c2b7f' });
    expect(parseCheckoutCreateInput({ amount: '10.00', requestId: 'f11dfba2-e371-4b3a-8446-a6b7339c2b7f' })).toBeNull();
    expect(parseCheckoutCreateInput({ amount: '1.00', requestId: 'not-a-uuid' })).toBeNull();
  });
});
