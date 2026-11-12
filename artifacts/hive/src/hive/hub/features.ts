/** The 19 cells of the hive. The centre is the Queen; the 18 around her are the features. */
export type Tab = 'home' | 'hive' | 'radar' | 'queen' | 'customers' | 'analytics' | 'calendar' | 'shop' | 'lab' | 'audit' | 'studio'
  | 'connections' | 'brief' | 'fees' | 'outlook' | 'export' | 'disputes' | 'payouts' | 'invoices' | 'agent';

export interface Feature {
  id: string; tab: Tab; name: string; icon: string; blurb: string;
}

export const QUEEN: Feature = { id: 'queen', tab: 'queen', name: 'Queen AI', icon: 'Q', blurb: 'Ask anything about your money. Every claim cites real transactions.' };

/** Ring 1 (6 cells, closest to the Queen) then ring 2 (12 cells), clockwise from the top. */
export const FEATURES: Feature[] = [
  { id: 'radar', tab: 'radar', name: 'Wasp Radar', icon: 'WR', blurb: 'Fraud and abuse alerts with the exact transactions behind each one.' },
  { id: 'brief', tab: 'brief', name: 'Daily Brief', icon: 'DB', blurb: 'The Queen’s morning summary: what changed, what to check first.' },
  { id: 'hive', tab: 'hive', name: 'Honey Stats', icon: 'HS', blurb: 'What you kept after refunds and PayPal fees, plus the 60-day honeycomb.' },
  { id: 'lab', tab: 'lab', name: 'Wasp Lab', icon: 'WL', blurb: 'Launch realistic attacks at HIVE and read the honest scorecard.' },
  { id: 'customers', tab: 'customers', name: 'Customers', icon: 'CU', blurb: 'Who pays, who repeats, and who drives your revenue.' },
  { id: 'analytics', tab: 'analytics', name: 'Analytics', icon: 'AN', blurb: 'Search every transaction in AG Grid with charts on top.' },

  { id: 'studio', tab: 'studio', name: 'Studio', icon: 'ST', blurb: 'Build your own dashboards with AG Studio.' },
  { id: 'fees', tab: 'fees', name: 'Fee Insights', icon: 'FI', blurb: 'What PayPal fees cost you, by size of payment and by month.' },
  { id: 'calendar', tab: 'calendar', name: 'Calendar', icon: 'CA', blurb: 'Estimated repeat payments and who is overdue (always labelled estimates).' },
  { id: 'outlook', tab: 'outlook', name: 'Cash Outlook', icon: 'CO', blurb: 'A cautious 30-day range from your history. An estimate, never income.' },
  { id: 'shop', tab: 'shop', name: 'Shop', icon: 'SH', blurb: 'Pay with the PayPal sandbox and watch the payment land in the hive.' },
  { id: 'export', tab: 'export', name: 'Export Center', icon: 'EX', blurb: 'Download transactions and alert evidence packets as CSV.' },
  { id: 'audit', tab: 'audit', name: 'Audit Log', icon: 'AU', blurb: 'Every decision, approval and action, in order.' },
  { id: 'connections', tab: 'connections', name: 'Connections', icon: 'CN', blurb: 'Is PayPal, Gemini and the database actually connected? Test it here.' },
  { id: 'disputes', tab: 'disputes', name: 'Disputes', icon: 'DI', blurb: 'HIVE writes the evidence from your records. You approve, then it goes to PayPal Disputes.' },
  { id: 'payouts', tab: 'payouts', name: 'Payouts', icon: 'PO', blurb: 'Pay someone through PayPal Payouts, with your approval and a hard daily cap.' },
  { id: 'invoices', tab: 'invoices', name: 'Invoices', icon: 'IN', blurb: 'Draft a PayPal invoice for repeat customers who are late. You send it.' },
  { id: 'agent', tab: 'agent', name: 'Agent Gate', icon: 'AG', blurb: 'Lets other AI agents ask HIVE “is this payment safe?” over MCP. Read-only.' },
];

const SIZE = 62;
export const HEX = SIZE;
export const SQ3 = Math.sqrt(3);

export interface Cell extends Feature { x: number; y: number; q: number; r: number; center: boolean }

const axial = (q: number, r: number) => ({ x: SIZE * SQ3 * (q + r / 2), y: SIZE * 1.5 * r });

function ring(n: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let q = -n; q <= n; q++) for (let r = -n; r <= n; r++) if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === n) out.push([q, r]);
  const ang = (q: number, r: number) => { const { x, y } = axial(q, r); const a = Math.atan2(x, -y); return a < 0 ? a + Math.PI * 2 : a; };
  return out.sort((a, b) => ang(a[0], a[1]) - ang(b[0], b[1]));
}

export function buildCells(): Cell[] {
  const slots = [...ring(1), ...ring(2)];
  const cells: Cell[] = [{ ...QUEEN, ...axial(0, 0), q: 0, r: 0, center: true }];
  FEATURES.forEach((f, i) => { const s = slots[i]; if (s) cells.push({ ...f, ...axial(s[0], s[1]), q: s[0], r: s[1], center: false }); });
  return cells;
}

export const hexPoints = (cx: number, cy: number, s: number) =>
  Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 180) * (60 * i - 30); return `${(cx + s * Math.cos(a)).toFixed(1)},${(cy + s * Math.sin(a)).toFixed(1)}`; }).join(' ');
