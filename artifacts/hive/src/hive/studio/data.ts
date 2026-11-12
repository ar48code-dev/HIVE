// AG Studio data sources built from HIVE's own API. Every row is a real transaction, alert or customer
// that HIVE already stores; nothing here is generated for the dashboard.
import type { AgDataSourcesDefinition, AgExpressionFieldDefinition, AgFieldDefinition, AgFormat, AgRelationDefinition } from 'ag-studio';
import type { Alert, CustomerRow, Txn } from '../api';

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];
const fields = (specs: FieldSpec[]): AgFieldDefinition[] => specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));
const sumOf = (id: string) => ({ id, aggregation: 'sum' as const });
const ratio = (id: string, name: string, description: string, numerator: string, denominator: string): AgExpressionFieldDefinition => ({
  id, name, description, format: 'percentageFormat', isMeasure: true,
  expression: { operator: 'divide', inputs: [sumOf(numerator), sumOf(denominator)] },
});

export const CALENDAR_ID = 'calendar';

export function buildStudioData(txns: Txn[], alerts: Alert[], customers: CustomerRow[]): AgDataSourcesDefinition {
  const severityOf = new Map<string, string>();
  const rank = { high: 3, medium: 2, low: 1 } as const;
  for (const t of txns) {
    const top = [...t.alerts].sort((a, b) => rank[b.severity] - rank[a.severity])[0];
    severityOf.set(t.id, top ? top.severity : 'none');
  }
  const byId = new Map(txns.map((t) => [t.id, t]));
  const days = txns.map((t) => new Date(t.at).toISOString().slice(0, 10)).sort();
  const today = new Date().toISOString().slice(0, 10);

  const transactionRows = txns.map((t) => ({
    id: t.id,
    date: new Date(t.at).toISOString().slice(0, 19),
    kind: t.kind === 'payment' ? 'Payment' : t.kind === 'refund' ? 'Refund' : 'Failed',
    customer: t.customer,
    source: t.source === 'paypal' ? 'PayPal sandbox' : 'Synthetic',
    paymentAmount: t.kind === 'payment' ? t.amountCents / 100 : 0,
    refundAmount: t.kind === 'refund' ? t.amountCents / 100 : 0,
    feeAmount: t.kind === 'payment' ? t.feeCents / 100 : 0,
    netCash: t.kind === 'payment' ? (t.amountCents - t.feeCents) / 100 : t.kind === 'refund' ? -t.amountCents / 100 : 0,
    severity: severityOf.get(t.id) ?? 'none',
    flagged: t.alerts.length ? 'Flagged by Wasp Radar' : 'Clear',
    injection: t.noteFlagged ? 'Instruction-like text' : 'Clean',
  }));

  const alertRows = alerts.map((a) => {
    const top = [...a.signals].sort((x, y) => y.weight - x.weight)[0];
    const txn = byId.get(a.txnId);
    return {
      id: `A-${a.id}`,
      txnId: txn ? a.txnId : '',
      customer: txn ? txn.customer : 'unknown',
      triggerKind: txn ? (txn.kind === 'payment' ? 'Payment' : txn.kind === 'refund' ? 'Refund' : 'Failed') : 'unknown',
      triggerAmount: txn ? txn.amountCents / 100 : 0,
      severity: a.severity,
      score: Math.round(a.score * 100),
      rule: top?.rule ?? 'UNKNOWN',
      status: a.status,
      evidenceCount: a.evidenceCount,
      pendingActions: a.pendingActions,
      createdAt: new Date(a.createdAt).toISOString().slice(0, 19),
    };
  });

  const customerRowsOut = customers.map((c) => ({
    customer: c.customer, payments: c.payments, refunds: c.refunds, failed: c.failed,
    revenue: c.revenueCents / 100, refundTotal: c.refundCents / 100, last30: c.last30Cents / 100,
    share30: c.shareOfLast30, kind: c.repeat ? 'Repeat' : 'One-time',
  }));

  const relationships: AgRelationDefinition[] = [
    { id: 'txn-customer', source: { tableId: 'transactions', fieldId: 'customer' }, target: { tableId: 'customers', fieldId: 'customer' }, type: 'many-to-one' },
    { id: 'transactions-date-calendar', source: { tableId: 'transactions', fieldId: 'date' }, target: { calendarId: CALENDAR_ID }, truncate: 'day' },
  ];

  return {
    description:
      'HIVE monitors a small merchant paid through PayPal. Transactions are payments, refunds and failed attempts from PayPal sandbox webhooks and Transaction Search. ' +
      'Alerts are rule-based flags from the deterministic risk engine (not model guesses) and link to the transaction that triggered them. ' +
      'Amounts are US dollars. Customers are pseudonymous aliases, not real names.',
    sources: [
      {
        id: 'customers',
        description: 'One row per pseudonymous customer, with 30-day share of revenue.',
        data: customerRowsOut,
        fields: fields([
          ['customer', 'Customer', 'textFormat'], ['payments', 'Payments', 'integerFormat'], ['refunds', 'Refunds', 'integerFormat'],
          ['failed', 'Failed attempts', 'integerFormat'], ['revenue', 'Lifetime revenue', 'currencyFormat'], ['refundTotal', 'Refunded', 'currencyFormat'],
          ['last30', 'Revenue, last 30 days', 'currencyFormat'], ['share30', 'Share of 30-day revenue', 'percentageFormat'], ['kind', 'Customer type', 'textFormat'],
        ]),
      },
      {
        id: 'transactions',
        description: 'Every payment, refund and failed attempt HIVE stored. Payment, refund and fee amounts are separate positive columns; Net cash is payment minus fee, or minus the refund.',
        data: transactionRows,
        fields: fields([
          ['id', 'Transaction ID', 'textFormat'], ['date', 'Date', 'dateTimeFormat'], ['kind', 'Kind', 'textFormat'], ['customer', 'Customer', 'textFormat'],
          ['source', 'Data source', 'textFormat'], ['paymentAmount', 'Payment amount', 'currencyFormat'], ['refundAmount', 'Refund amount', 'currencyFormat'],
          ['feeAmount', 'PayPal fee', 'currencyFormat'], ['netCash', 'Net cash', 'currencyFormat'], ['severity', 'Alert severity', 'textFormat'],
          ['flagged', 'Radar status', 'textFormat'], ['injection', 'Text check', 'textFormat'],
        ]),
      },
      {
        id: 'alerts',
        description: 'Wasp Radar alerts. Each carries the transaction that triggered it (id, kind, amount, customer); Evidence count is how many transactions back it up.',
        data: alertRows,
        fields: fields([
          ['id', 'Alert', 'textFormat'], ['txnId', 'Trigger transaction', 'textFormat'], ['customer', 'Customer', 'textFormat'], ['triggerKind', 'Trigger kind', 'textFormat'], ['triggerAmount', 'Trigger amount', 'currencyFormat'], ['severity', 'Severity', 'textFormat'], ['score', 'Risk score (0-100)', 'integerFormat'],
          ['rule', 'Top rule', 'textFormat'], ['status', 'Review status', 'textFormat'], ['evidenceCount', 'Evidence transactions', 'integerFormat'],
          ['pendingActions', 'Pending actions', 'integerFormat'], ['createdAt', 'Raised at', 'dateTimeFormat'],
        ]),
      },
    ],
    relationships,
    calendars: [{
      id: CALENDAR_ID, label: 'Calendar',
      range: { from: { type: 'date', value: days[0] ?? today }, to: { type: 'date', value: days.at(-1) ?? today } },
      fragments: ['year', 'quarter', 'month', 'week', 'day', 'dayOfWeek'],
    }],
    expressions: [
      ratio('refundRate', 'Refund rate', 'Refunded money divided by payment money.', 'transactions.refundAmount', 'transactions.paymentAmount'),
      ratio('feeRate', 'Fee rate', 'PayPal fees divided by payment money.', 'transactions.feeAmount', 'transactions.paymentAmount'),
      ratio('keepRate', 'Kept after refunds and fees', 'Net cash divided by payment money.', 'transactions.netCash', 'transactions.paymentAmount'),
    ],
  };
}
