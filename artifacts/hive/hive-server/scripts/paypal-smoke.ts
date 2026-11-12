/**
 * Day-one check against the Sandbox. Run: pnpm --filter @workspace/hive run paypal:smoke
 * Prints what works and what does not, so problems surface before anything is built on them.
 */
import { createOrder, getAccessToken, searchTransactions } from '../src/paypal/client.js';

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    const out = await fn();
    console.log(`OK    ${name}`, out ?? '');
  } catch (e) {
    console.log(`FAIL  ${name}\n      ${(e as Error).message.slice(0, 400)}`);
  }
}

await step('OAuth token', async () => ((await getAccessToken()).length > 10 ? 'token received' : 'empty'));
await step('Create order', async () => {
  const o = await createOrder('5.00', 'USD', 'hive-smoke');
  return { id: o.id, approve: o.links.find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href };
});
await step('Transaction Search (last 2 days)', async () => {
  const end = new Date();
  const start = new Date(end.getTime() - 2 * 86400000);
  const r = await searchTransactions(start.toISOString(), end.toISOString());
  return { count: r.transaction_details?.length ?? 0, note: 'If this fails with a permission error, enable Transaction Search on the app.' };
});
