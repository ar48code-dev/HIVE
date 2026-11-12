/*
 * Live Wasp Lab: play an attack against the real PayPal sandbox so the whole path
 * (order, capture, webhook, detection) is exercised. PayPal will not let us backdate
 * payments, so only attacks that unfold within minutes can run live.
 */
export interface LiveStep {
  kind: 'order' | 'refund';
  label: string;
  /** Dollars, as a string with two decimals. */
  amount?: string;
  /** For refunds: index of the order step being refunded. */
  refundOf?: number;
  pauseMs: number;
}

export const LIVE_ATTACKS = ['card_testing', 'duplicate_payment', 'new_customer_large', 'refund_abuse'] as const;
export type LiveAttack = (typeof LIVE_ATTACKS)[number];

export const LIVE_NOTES: Record<LiveAttack, string> = {
  card_testing: 'Twelve payments of about $1 within a few minutes. Use one sandbox buyer.',
  duplicate_payment: 'The same amount twice within two minutes from one sandbox buyer.',
  new_customer_large: 'One order about 50 times the shop\'s normal size. Use a FRESH sandbox buyer, because an established buyer is treated as lower risk.',
  refund_abuse: 'Three pay-and-refund cycles within minutes from one sandbox buyer.',
};

export function planLive(attack: LiveAttack, rand: () => number = Math.random): LiveStep[] {
  const dollars = (lo: number, hi: number) => (lo + rand() * (hi - lo)).toFixed(2);
  switch (attack) {
    case 'card_testing':
      return Array.from({ length: 12 }, (_, i) => ({ kind: 'order', label: `tiny payment ${i + 1} of 12`, amount: dollars(0.5, 1.5), pauseMs: 15_000 }));
    case 'duplicate_payment': {
      const amount = dollars(80, 140);
      return [
        { kind: 'order', label: 'first payment', amount, pauseMs: 20_000 },
        { kind: 'order', label: 'same payment again', amount, pauseMs: 0 },
      ];
    }
    case 'new_customer_large':
      return [{ kind: 'order', label: 'unusually large first order', amount: dollars(2000, 2800), pauseMs: 0 }];
    case 'refund_abuse': {
      const steps: LiveStep[] = [];
      for (let i = 0; i < 3; i++) {
        steps.push({ kind: 'order', label: `purchase ${i + 1}`, amount: dollars(55, 65), pauseMs: 10_000 });
        steps.push({ kind: 'refund', label: `refund ${i + 1}`, refundOf: steps.length - 1, pauseMs: 10_000 });
      }
      return steps;
    }
  }
}
