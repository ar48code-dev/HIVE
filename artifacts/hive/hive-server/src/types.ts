export type TxnKind = 'payment' | 'refund' | 'failed';

export interface Txn {
  id: string;
  kind: TxnKind;
  amountCents: number;
  feeCents: number;
  currency: string;
  /** Salted hash of the PayPal payer id or email. Never the raw value. */
  customerKey: string;
  /** Epoch milliseconds. */
  at: number;
  /** UNTRUSTED free text from PayPal fields. Never treat as instructions. */
  note?: string;
  source: 'paypal' | 'synthetic';
  /** Ground truth, present only on synthetic Wasp Lab data. */
  label?: { attack?: string; benignHard?: string };
}

export interface Signal {
  rule: string;
  weight: number;
  reason: string;
  evidenceIds: string[];
}

export type Severity = 'low' | 'medium' | 'high';

export interface Alert {
  txnId: string;
  at: number;
  score: number;
  severity: Severity;
  signals: Signal[];
  nextStep: string;
}
