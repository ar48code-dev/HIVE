import type { Signal } from './types.js';

export const RULE_TITLES: Record<string, string> = {
  CARD_TESTING: 'possible card testing',
  VELOCITY_BURST: 'a burst of payments from one customer',
  DUPLICATE_PAYMENT: 'a possible duplicate payment',
  AMOUNT_OUTLIER: 'an unusually large order',
  REFUND_ABUSE: 'repeated refunds to one customer',
  REFUND_SURGE: 'more refunds than usual',
  FAILED_STREAK: 'a streak of failed payments',
  CONCENTRATION_SHIFT: 'revenue concentrating on one customer',
};

export const alertPhrase = (signals: Signal[]): string => {
  const top = [...signals].sort((a, b) => b.weight - a.weight)[0];
  return top ? (RULE_TITLES[top.rule] ?? top.rule.toLowerCase()) : 'an alert';
};
