import { pool } from './db.js';
import { mergeAlerts, sameGroup } from './alertGrouping.js';
import type { Alert, Txn } from './types.js';

export type AlertStatus = 'open' | 'reviewed' | 'dismissed';
export interface StoredAlert extends Alert { id: number; status: AlertStatus; createdAt: number }

export type ActionType = 'refund_draft' | 'evidence_packet';
export type ActionStatus = 'proposed' | 'approved' | 'rejected' | 'executed' | 'failed';
export interface StoredAction {
  id: number; alertId: number; type: ActionType; payload: Record<string, unknown>;
  status: ActionStatus; proposedBy: string; decidedBy?: string; createdAt: number; decidedAt?: number;
  result?: Record<string, unknown>;
}
export type OpKind = 'dispute_response' | 'payout' | 'invoice';
export interface StoredOp {
  id: number; kind: OpKind; key?: string; payload: Record<string, unknown>; status: ActionStatus;
  decidedBy?: string; createdAt: number; decidedAt?: number; result?: Record<string, unknown>;
}
export interface AuditEntry { id: number; at: number; actor: string; event: string; detail: unknown }

export interface Repo {
  /** Returns true only when this transaction was newly inserted. */
  upsertTxn(t: Txn, extra?: { orderId?: string; captureId?: string }): Promise<boolean>;
  listTxns(sinceMs: number): Promise<Txn[]>;
  getTxns(ids: string[]): Promise<Txn[]>;
  saveAlert(a: Alert): Promise<StoredAlert>;
  listAlerts(): Promise<StoredAlert[]>;
  getAlert(id: number): Promise<StoredAlert | null>;
  setAlertStatus(id: number, status: AlertStatus): Promise<void>;
  createAction(alertId: number, type: ActionType, payload: Record<string, unknown>): Promise<StoredAction>;
  listActions(alertId?: number): Promise<StoredAction[]>;
  getAction(id: number): Promise<StoredAction | null>;
  decideAction(id: number, status: ActionStatus, by: string, result?: Record<string, unknown>): Promise<void>;
  createOp(kind: OpKind, payload: Record<string, unknown>, key?: string): Promise<StoredOp>;
  listOps(kind?: OpKind): Promise<StoredOp[]>;
  getOp(id: number): Promise<StoredOp | null>;
  decideOp(id: number, status: ActionStatus, by: string, result?: Record<string, unknown>): Promise<void>;
  /** Merge extra fields into an op's result without changing its status (used when an invoice draft is later sent). */
  patchOpResult(id: number, extra: Record<string, unknown>): Promise<void>;
  audit(actor: string, event: string, detail?: unknown): Promise<void>;
  listAudit(limit?: number): Promise<AuditEntry[]>;
  saveWasplab(report: unknown): Promise<void>;
  latestWasplab(): Promise<unknown | null>;
}

export class MemoryRepo implements Repo {
  private txns = new Map<string, Txn>();
  private alerts: StoredAlert[] = [];
  private actions: StoredAction[] = [];
  private log: AuditEntry[] = [];
  private wasplab: unknown | null = null;
  private ops: StoredOp[] = [];
  private seq = { alert: 0, action: 0, audit: 0, op: 0 };

  async upsertTxn(t: Txn) {
    if (this.txns.has(t.id)) return false;
    this.txns.set(t.id, t);
    return true;
  }
  async listTxns(sinceMs: number) { return [...this.txns.values()].filter((t) => t.at >= sinceMs).sort((a, b) => a.at - b.at); }
  async getTxns(ids: string[]) { return ids.map((i) => this.txns.get(i)).filter((t): t is Txn => !!t); }

  async saveAlert(a: Alert): Promise<StoredAlert> {
    const dup = this.alerts.find((x) => x.txnId === a.txnId);
    if (dup) return dup;
    const group = this.alerts.find((x) => sameGroup(x, a));
    if (group) {
      Object.assign(group, mergeAlerts(group, a));
      return group;
    }
    const s: StoredAlert = { ...a, id: ++this.seq.alert, status: 'open', createdAt: Date.now() };
    this.alerts.push(s);
    return s;
  }
  async listAlerts() { return [...this.alerts].sort((a, b) => b.at - a.at); }
  async getAlert(id: number) { return this.alerts.find((a) => a.id === id) ?? null; }
  async setAlertStatus(id: number, status: AlertStatus) { const a = this.alerts.find((x) => x.id === id); if (a) a.status = status; }

  async createAction(alertId: number, type: ActionType, payload: Record<string, unknown>) {
    const ex = this.actions.find((a) => a.alertId === alertId && a.type === type);
    if (ex) return ex;
    const a: StoredAction = { id: ++this.seq.action, alertId, type, payload, status: 'proposed', proposedBy: 'queen-ai', createdAt: Date.now() };
    this.actions.push(a);
    return a;
  }
  async listActions(alertId?: number) { return this.actions.filter((a) => alertId === undefined || a.alertId === alertId); }
  async getAction(id: number) { return this.actions.find((a) => a.id === id) ?? null; }
  async decideAction(id: number, status: ActionStatus, by: string, result?: Record<string, unknown>) {
    const a = this.actions.find((x) => x.id === id);
    if (a) Object.assign(a, { status, decidedBy: by, decidedAt: Date.now(), result });
  }

  async createOp(kind: OpKind, payload: Record<string, unknown>, key?: string) {
    const ex = key ? this.ops.find((o) => o.kind === kind && o.key === key) : undefined; if (ex) return ex;
    const o: StoredOp = { id: ++this.seq.op, kind, key, payload, status: 'proposed', createdAt: Date.now() }; this.ops.push(o); return o;
  }
  async listOps(kind?: OpKind) { return this.ops.filter((o) => !kind || o.kind === kind).sort((a, b) => b.id - a.id); }
  async getOp(id: number) { return this.ops.find((o) => o.id === id) ?? null; }
  async decideOp(id: number, status: ActionStatus, by: string, result?: Record<string, unknown>) { const o = this.ops.find((x) => x.id === id); if (o) Object.assign(o, { status, decidedBy: by, decidedAt: Date.now(), result }); }
  async patchOpResult(id: number, extra: Record<string, unknown>) { const o = this.ops.find((x) => x.id === id); if (o) o.result = { ...(o.result ?? {}), ...extra }; }

  async audit(actor: string, event: string, detail: unknown = {}) { this.log.push({ id: ++this.seq.audit, at: Date.now(), actor, event, detail }); }
  async listAudit(limit = 200) { return [...this.log].reverse().slice(0, limit); }
  async saveWasplab(report: unknown) { this.wasplab = report; }
  async latestWasplab() { return this.wasplab; }
}

const rowTxn = (r: any): Txn => ({
  id: r.id, kind: r.kind, amountCents: Number(r.amount_cents), feeCents: Number(r.fee_cents), currency: r.currency,
  customerKey: r.customer_key, at: new Date(r.at).getTime(), note: r.note ?? undefined, source: r.source,
});
const rowAlert = (r: any): StoredAlert => ({
  id: Number(r.id), txnId: r.txn_id, at: new Date(r.txn_at ?? r.created_at).getTime(), score: Number(r.score),
  severity: r.severity, signals: r.signals, nextStep: r.next_step, status: r.status, createdAt: new Date(r.created_at).getTime(),
});
const rowAction = (r: any): StoredAction => ({
  id: Number(r.id), alertId: Number(r.alert_id), type: r.type, payload: r.payload, status: r.status, proposedBy: r.proposed_by,
  decidedBy: r.decided_by ?? undefined, createdAt: new Date(r.created_at).getTime(),
  decidedAt: r.decided_at ? new Date(r.decided_at).getTime() : undefined, result: r.result ?? undefined,
});

const rowOp = (r: any): StoredOp => ({
  id: Number(r.id), kind: r.kind, key: r.key ?? undefined, payload: r.payload, status: r.status, decidedBy: r.decided_by ?? undefined,
  createdAt: new Date(r.created_at).getTime(), decidedAt: r.decided_at ? new Date(r.decided_at).getTime() : undefined, result: r.result ?? undefined,
});

const ALERT_SELECT = 'SELECT a.*, t.at AS txn_at FROM alerts a JOIN transactions t ON t.id = a.txn_id';

export class PgRepo implements Repo {
  async upsertTxn(t: Txn, extra: { orderId?: string; captureId?: string } = {}) {
    const result = await pool.query(
      `INSERT INTO transactions (id, paypal_id, kind, amount_cents, fee_cents, currency, customer_key, at, note, source, order_id, capture_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8/1000.0),$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      [t.id, t.id.replace(/^pp-/, ''), t.kind, t.amountCents, t.feeCents, t.currency, t.customerKey, t.at, t.note ?? null, t.source, extra.orderId ?? null, extra.captureId ?? null],
    );
    return result.rowCount === 1;
  }
  async listTxns(sinceMs: number) {
    return (await pool.query('SELECT * FROM transactions WHERE at >= to_timestamp($1/1000.0) ORDER BY at ASC', [sinceMs])).rows.map(rowTxn);
  }
  async getTxns(ids: string[]) {
    if (!ids.length) return [];
    return (await pool.query('SELECT * FROM transactions WHERE id = ANY($1)', [ids])).rows.map(rowTxn);
  }
  async saveAlert(a: Alert): Promise<StoredAlert> {
    const dup = (await pool.query(`${ALERT_SELECT} WHERE a.txn_id=$1`, [a.txnId])).rows[0];
    if (dup) return rowAlert(dup);
    const recent = (await pool.query(`${ALERT_SELECT} WHERE a.status='open' AND t.at > to_timestamp($1/1000.0) ORDER BY t.at DESC LIMIT 100`, [a.at - 40 * 86_400_000])).rows.map(rowAlert);
    const group = recent.find((x) => sameGroup(x, a));
    if (group) {
      const m = mergeAlerts(group, a);
      await pool.query('UPDATE alerts SET signals=$2, score=$3, severity=$4 WHERE id=$1', [group.id, JSON.stringify(m.signals), m.score, m.severity]);
      return { ...group, ...m };
    }
    const ins = await pool.query(
      'INSERT INTO alerts (txn_id, score, severity, signals, next_step) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [a.txnId, a.score, a.severity, JSON.stringify(a.signals), a.nextStep],
    );
    return (await this.getAlert(Number(ins.rows[0].id))) as StoredAlert;
  }
  async listAlerts() { return (await pool.query(`${ALERT_SELECT} ORDER BY t.at DESC LIMIT 200`)).rows.map(rowAlert); }
  async getAlert(id: number) { const r = (await pool.query(`${ALERT_SELECT} WHERE a.id=$1`, [id])).rows[0]; return r ? rowAlert(r) : null; }
  async setAlertStatus(id: number, status: AlertStatus) { await pool.query('UPDATE alerts SET status=$2 WHERE id=$1', [id, status]); }

  async createAction(alertId: number, type: ActionType, payload: Record<string, unknown>) {
    const ex = (await pool.query('SELECT * FROM actions WHERE alert_id=$1 AND type=$2 LIMIT 1', [alertId, type])).rows[0];
    if (ex) return rowAction(ex);
    const r = await pool.query('INSERT INTO actions (alert_id, type, payload) VALUES ($1,$2,$3) RETURNING *', [alertId, type, JSON.stringify(payload)]);
    return rowAction(r.rows[0]);
  }
  async listActions(alertId?: number) {
    const r = alertId === undefined ? await pool.query('SELECT * FROM actions ORDER BY id DESC LIMIT 200') : await pool.query('SELECT * FROM actions WHERE alert_id=$1 ORDER BY id', [alertId]);
    return r.rows.map(rowAction);
  }
  async getAction(id: number) { const r = (await pool.query('SELECT * FROM actions WHERE id=$1', [id])).rows[0]; return r ? rowAction(r) : null; }
  async decideAction(id: number, status: ActionStatus, by: string, result?: Record<string, unknown>) {
    await pool.query('UPDATE actions SET status=$2, decided_by=$3, decided_at=now(), result=$4 WHERE id=$1', [id, status, by, result ? JSON.stringify(result) : null]);
  }
  async createOp(kind: OpKind, payload: Record<string, unknown>, key?: string) {
    if (key) { const ex = (await pool.query('SELECT * FROM ops WHERE kind=$1 AND key=$2', [kind, key])).rows[0]; if (ex) return rowOp(ex); }
    return rowOp((await pool.query('INSERT INTO ops (kind, key, payload) VALUES ($1,$2,$3) RETURNING *', [kind, key ?? null, JSON.stringify(payload)])).rows[0]);
  }
  async listOps(kind?: OpKind) {
    const r = kind ? await pool.query('SELECT * FROM ops WHERE kind=$1 ORDER BY id DESC LIMIT 200', [kind]) : await pool.query('SELECT * FROM ops ORDER BY id DESC LIMIT 200');
    return r.rows.map(rowOp);
  }
  async getOp(id: number) { const r = (await pool.query('SELECT * FROM ops WHERE id=$1', [id])).rows[0]; return r ? rowOp(r) : null; }
  async decideOp(id: number, status: ActionStatus, by: string, result?: Record<string, unknown>) {
    await pool.query('UPDATE ops SET status=$2, decided_by=$3, decided_at=now(), result=$4 WHERE id=$1', [id, status, by, result ? JSON.stringify(result) : null]);
  }
  async patchOpResult(id: number, extra: Record<string, unknown>) { await pool.query("UPDATE ops SET result = COALESCE(result, '{}'::jsonb) || $2::jsonb WHERE id=$1", [id, JSON.stringify(extra)]); }
  async audit(actor: string, event: string, detail: unknown = {}) {
    await pool.query('INSERT INTO audit_log (actor, event, detail) VALUES ($1,$2,$3)', [actor, event, JSON.stringify(detail)]);
  }
  async listAudit(limit = 200) {
    return (await pool.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT $1', [limit])).rows.map((r: any) => ({ id: Number(r.id), at: new Date(r.at).getTime(), actor: r.actor, event: r.event, detail: r.detail }));
  }
  async saveWasplab(report: unknown) { await pool.query('INSERT INTO wasplab_runs (report) VALUES ($1)', [JSON.stringify(report)]); }
  async latestWasplab() { return (await pool.query('SELECT report FROM wasplab_runs ORDER BY id DESC LIMIT 1')).rows[0]?.report ?? null; }
}
