export type Severity = 'low' | 'medium' | 'high';
export interface Signal { rule: string; weight: number; reason: string; evidenceIds: string[] }
export interface Alert {
  id: number; txnId: string; at: number; score: number; severity: Severity; signals: Signal[]; nextStep: string;
  status: 'open' | 'reviewed' | 'dismissed'; createdAt: number; evidenceCount: number; pendingActions: number;
}
export interface Action {
  id: number; alertId: number; type: 'refund_draft' | 'evidence_packet'; payload: Record<string, any>;
  status: 'proposed' | 'approved' | 'rejected' | 'executed' | 'failed'; decidedBy?: string; result?: Record<string, any>;
}
export interface Txn {
  id: string; kind: 'payment' | 'refund' | 'failed'; amountCents: number; feeCents: number; currency: string; at: number;
  customer: string; source: 'paypal' | 'synthetic'; note: string; noteFlagged: boolean; alerts: Array<{ id: number; severity: Severity }>;
}
export interface Period { revenueCents: number; payments: number; refunds: number; refundCents: number; feesCents: number; netCents: number; failed: number }
export interface Summary {
  asOf: number; currency: string; last30: Period; prior30: Period; repeatRate: number;
  topCustomer: { alias: string; shareOfRevenue: number; revenueCents: number } | null;
  daily: Array<{ day: string; revenue: number; refunds: number; payments: number }>;
}
export interface Claim { text: string; evidenceIds: string[] }
export interface QueenAnswer {
  answer: string; claims: Claim[]; confidence: 'low' | 'medium' | 'high'; insufficientData: boolean; mode: 'gemini' | 'template' | 'recorded'; intent?: string;
  validation: { ok: boolean; issues: string[]; retried: boolean; fellBack: boolean; checkedClaims: number; checkedTransactions: number };
  evidence: Array<{ id: string; kind: string; amountCents: number; at: number; customer: string; injectionSuspected: boolean }>;
}
export interface LabReport {
  generatedAt: string; seeds: number; overallRecall: number; falseAlarmsPer1000Benign: number; hardNegativeFalseAlarmRate: number;
  scenarios: Array<{ attack: string; runs: number; caught: number; caughtByExpectedRule: number; recall: number; medianDetectMs: number | null; medianAttackTxnsBeforeAlert: number | null }>;
  injection: { attacksFlagged: number; attacksTotal: number; benignFlagged: number; benignTotal: number };
  misses: Array<{ attack: string; seed: number }>;
}
export interface CustomerRow {
  customer: string; payments: number; refunds: number; failed: number; revenueCents: number; refundCents: number;
  last30Cents: number; shareOfLast30: number; firstAt: number; lastAt: number; repeat: boolean;
}
export interface Recurring {
  customer: string; cadenceDays: number; typicalCents: number; lastAt: number; nextAt: number; daysUntil: number;
  overdue: boolean; confidence: 'low' | 'medium' | 'high'; paymentIds: string[]; estimate: true;
}
export interface Growth { cells: number; capacity: number; achievements: Array<{ id: string; title: string; hint: string; done: boolean }> }
export interface SimResult { attack: string; transactions: number; alertIds: number[]; firstAlertAfter: number | null }
export interface ModeInfo { demo: boolean; ai: string; authRequired: boolean; brain?: boolean; secondOpinion?: boolean }
export interface SecondOpinionRow { id: string; at: number; kind: string; amountCents: number; customer: string; risk: number; why: Array<[string, number]> }
export interface SecondOpinion { enabled: boolean; applicable?: boolean; reason?: string; scored?: number; flaggedByModel?: number; modelOnly?: SecondOpinionRow[]; note?: string; error?: string }
export interface AppConfig { demo: boolean; paypalClientId: string; currency: string }
export interface AuditEntry { id: number; at: number; actor: string; event: string; detail: unknown }

const TOKEN_KEY = 'hive-admin-token';
export const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; } };
export const setToken = (t: string) => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage may be blocked */ } };
export const appPath = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(appPath(path), { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}
export const post = <T,>(path: string, data: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(data) });

export const money = (cents: number, signed = false) => {
  const s = `$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return signed ? `${cents >= 0 ? '+' : '-'}${s}` : s;
};
export const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const RULE_TITLE: Record<string, string> = {
  CARD_TESTING: 'Possible card testing',
  VELOCITY_BURST: 'Burst of payments from one customer',
  DUPLICATE_PAYMENT: 'Possible duplicate payment',
  AMOUNT_OUTLIER: 'Unusually large order',
  REFUND_ABUSE: 'Repeated refunds to one customer',
  REFUND_SURGE: 'More refunds than usual',
  FAILED_STREAK: 'Streak of failed payments',
  CONCENTRATION_SHIFT: 'Revenue concentrating on one customer',
};
export const alertTitle = (a: Pick<Alert, 'signals'>) => {
  const top = [...a.signals].sort((x, y) => y.weight - x.weight)[0];
  return top ? (RULE_TITLE[top.rule] ?? top.rule) : 'Alert';
};
export const SEVERITY_LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' };
export const SCENARIO_TITLE: Record<string, string> = {
  card_testing: 'Card testing', slow_card_testing: 'Slow card testing', refund_abuse: 'Refund abuse', concentration_shift: 'Revenue concentration',
  duplicate_payment: 'Duplicate payment', new_customer_large: 'Large first-time order', failed_streak: 'Failed-payment streak',
};
export const duration = (ms: number | null) =>
  ms === null ? 'n/a' : ms < 1000 ? 'instant' : ms < 90_000 ? `${Math.round(ms / 1000)} sec` : ms < 5_400_000 ? `${Math.round(ms / 60000)} min` : ms < 172_800_000 ? `${(ms / 3_600_000).toFixed(1)} hours` : `${(ms / 86_400_000).toFixed(1)} days`;
