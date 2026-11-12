/**
 * Optional bridge to the local "brain" service (learned router, note screening, risk second opinion, policy firewall).
 * Off unless BRAIN_URL is set. Every call fails soft: on any network error HIVE behaves exactly as it does without the brain.
 */
import type { Txn } from '../types.js';

export interface BrainRoute { intent: string; confidence: number; refuse: boolean; injection?: boolean; backstop?: boolean }
export interface BrainCheck { injection: boolean; injection_prob: number; regex_flag: boolean; pii_found: string[]; masked: string }
export interface BrainScore { i: number; risk: number; flag_model: boolean; flag_rules: boolean; why: Array<[string, number]> }
export interface BrainTxn { t: number; c: string; a: number; k: 'pay' | 'refund' | 'fail' }

let downUntil = 0;
const url = () => (process.env.BRAIN_URL ?? '').replace(/\/$/, '');
export const brainEnabled = () => !!url();
export function resetBrainCircuit(): void { downUntil = 0; }

/** POST to the brain. Returns null when disabled, unreachable, timed out, or the brain refused the request (4xx or a plain 500). Network errors, timeouts and 502/503/504 pause calls for 30 s: one bad request must not switch the brain off. */
export async function brainCall<T>(path: string, body: unknown, timeoutMs = 1500): Promise<T | null> {
  if (!url() || Date.now() < downUntil) return null;
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (process.env.BRAIN_TOKEN) headers.authorization = `Bearer ${process.env.BRAIN_TOKEN}`;
    const res = await fetch(url() + path, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new Error(`brain ${res.status}`); // gateway-style outage
    if (!res.ok) return null; // 4xx, or a 500 caused by this one request
    return (await res.json()) as T;
  } catch {
    downUntil = Date.now() + 30_000;
    return null;
  }
}

export const brainRoute = (text: string) => brainCall<BrainRoute>('/route', { text: text.slice(0, 500) });
export const brainCheck = (text: string) => brainCall<BrainCheck>('/check', { text: text.slice(0, 500) });
export const brainScore = (txns: BrainTxn[]) => brainCall<BrainScore[]>('/score', { txns }, 8000);
export const toBrainTxn = (t: Txn): BrainTxn => ({ t: t.at / 1000, c: t.customerKey, a: t.amountCents / 100, k: t.kind === 'payment' ? 'pay' : t.kind === 'refund' ? 'refund' : 'fail' });
