import { customerKey, toCents } from './normalize.js';
import { searchTransactions } from './paypal/client.js';
import type { Repo } from './repo.js';
import type { Txn } from './types.js';

/*
 * Maps one item of PayPal's Transaction Search response to a Txn.
 * Field names follow PayPal's reporting API as documented; they have NOT been checked against a live
 * sandbox response yet. If `pnpm --filter @workspace/hive run backfill` reports skipped items, inspect and adjust here.
 */
export function searchItemToTxn(item: any): { txn: Txn; captureId: string } | null {
  const info = item?.transaction_info;
  if (!info?.transaction_id || !info?.transaction_amount?.value) return null;
  const code = String(info.transaction_event_code ?? '');
  const value = Number(info.transaction_amount.value);
  const denied = info.transaction_status === 'D';
  let kind: Txn['kind'] | null = null;
  if (denied) kind = 'failed';
  else if (code === 'T1107' || (code.startsWith('T11') && value < 0)) kind = 'refund'; // refunds and reversals
  else if (code.startsWith('T00') && value > 0) kind = 'payment'; // payments received
  if (!kind) return null; // transfers, withdrawals, fees, and so on are not shop revenue

  const payer = item?.payer_info?.account_id ?? item?.payer_info?.email_address ?? info.paypal_account_id ?? 'unknown';
  const fee = info.fee_amount?.value ? Math.abs(toCents(info.fee_amount.value)) : 0;
  return {
    captureId: String(info.transaction_id),
    txn: {
      id: `pp-${info.transaction_id}`,
      kind,
      amountCents: Math.abs(toCents(info.transaction_amount.value)),
      feeCents: kind === 'payment' ? fee : 0,
      currency: info.transaction_amount.currency_code ?? 'USD',
      customerKey: customerKey(String(payer)),
      at: Date.parse(info.transaction_initiation_date ?? info.transaction_updated_date ?? ''),
      note: [info.transaction_note, info.transaction_subject, info.custom_field].filter(Boolean).join(' | ') || undefined,
      source: 'paypal',
    },
  };
}

export interface BackfillResult { windows: number; fetched: number; mapped: number; inserted: number; skipped: number }

/** Pull history in 30-day windows (the API limits the range per request) and merge it with webhook data. */
export async function backfill(repo: Repo, days: number, fetcher: typeof searchTransactions = searchTransactions): Promise<BackfillResult> {
  const res: BackfillResult = { windows: 0, fetched: 0, mapped: 0, inserted: 0, skipped: 0 };
  const known = new Set((await repo.listTxns(0)).map((t) => t.id));
  const end = Date.now();
  for (let from = end - days * 86_400_000; from < end; from += 30 * 86_400_000) {
    const to = Math.min(from + 30 * 86_400_000, end);
    res.windows++;
    let page = 1, pages = 1;
    do {
      const r = await fetcher(new Date(from).toISOString(), new Date(to).toISOString(), page);
      pages = Number(r?.total_pages ?? 1);
      for (const item of r?.transaction_details ?? []) {
        res.fetched++;
        const m = searchItemToTxn(item);
        if (!m || Number.isNaN(m.txn.at)) { res.skipped++; continue; }
        res.mapped++;
        if (known.has(m.txn.id)) continue; // already arrived by webhook
        await repo.upsertTxn(m.txn, { captureId: m.captureId });
        known.add(m.txn.id);
        res.inserted++;
      }
      page++;
    } while (page <= pages);
  }
  await repo.audit('system', 'backfill', { ...res, days });
  return res;
}
