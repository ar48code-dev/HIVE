/**
 * Live Wasp Lab: plays an attack against the real PayPal sandbox and measures how long HIVE takes to alert.
 *
 *   1. Deploy or run the HIVE server with the webhook registered.
 *   2. pnpm --filter @workspace/hive run wasplab:live -- card_testing
 *
 * Env: HIVE_URL (default http://localhost:8080), LIVE_APPROVER=manual|playwright,
 *      SANDBOX_BUYER_EMAIL and SANDBOX_BUYER_PASSWORD (for the playwright approver).
 * Not yet run against the sandbox. The approval page is PayPal's and may change, so expect to adjust scripts/live/approve.py.
 */
import { spawnSync } from 'node:child_process';
import { captureOrder, createOrder, getOrder, refundCapture } from '../src/paypal/client.js';
import { LIVE_ATTACKS, LIVE_NOTES, planLive, type LiveAttack } from '../src/wasplab/live.js';

const attack = process.argv[2] as LiveAttack;
if (!LIVE_ATTACKS.includes(attack)) {
  console.error(`Choose one of: ${LIVE_ATTACKS.join(', ')}\n`);
  for (const a of LIVE_ATTACKS) console.error(`  ${a}: ${LIVE_NOTES[a]}`);
  process.exit(1);
}
const HIVE = process.env.HIVE_URL ?? 'http://localhost:23027/hive';
const mode = process.env.LIVE_APPROVER ?? 'manual';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function approve(orderId: string, url: string) {
  if (mode === 'playwright') {
    const r = spawnSync('python3', ['scripts/live/approve.py', url], { stdio: 'inherit', env: process.env });
    if (r.status !== 0) throw new Error('The automatic approver failed. See its output, or use LIVE_APPROVER=manual.');
  } else {
    console.log(`  Approve this order as the sandbox buyer:\n  ${url}`);
  }
  for (let i = 0; i < 150; i++) {
    const o = await getOrder(orderId);
    if (o.status === 'APPROVED') return;
    await sleep(2000);
  }
  throw new Error(`Order ${orderId} was not approved within 5 minutes.`);
}

console.log(`Live Wasp Lab: ${attack}\n${LIVE_NOTES[attack]}\n`);
const steps = planLive(attack);
const captures: string[] = [];
let firstAt = 0;

for (const [i, s] of steps.entries()) {
  console.log(`[${i + 1}/${steps.length}] ${s.label}${s.amount ? ` ($${s.amount})` : ''}`);
  if (s.kind === 'order') {
    const order = await createOrder(s.amount as string, 'USD', `wasplab-${attack}`, `wasplab-${attack}-${Date.now()}-${i}`);
    const link = order.links.find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href;
    if (!link) throw new Error('PayPal returned no approval link. Print the order response and check the create call.');
    await approve(order.id, link);
    const cap = await captureOrder(order.id);
    const id = cap?.purchase_units?.[0]?.payments?.captures?.[0]?.id as string | undefined;
    if (!id) throw new Error('Capture did not return a capture id.');
    captures[i] = id;
    firstAt ||= Date.now();
    console.log(`  captured ${id}`);
  } else {
    const target = captures[s.refundOf as number];
    const amount = steps[s.refundOf as number]?.amount as string;
    if (!target) throw new Error('Nothing to refund.');
    const r = await refundCapture(target, amount, 'USD', `wasplab-refund-${target}`, 'Wasp Lab test refund');
    console.log(`  refunded (${r?.status})`);
  }
  if (s.pauseMs) await sleep(s.pauseMs);
}

console.log('\nWaiting for HIVE to raise an alert (webhooks can take a few seconds)...');
const mine = new Set(captures.filter(Boolean).map((c) => `pp-${c}`));
const deadline = Date.now() + 180_000;
while (Date.now() < deadline) {
  const alerts: any[] = await fetch(`${HIVE}/api/alerts`).then((r) => r.json()).catch(() => []);
  const hit = alerts.find((a) => a.signals.some((s: any) => s.evidenceIds.some((id: string) => mine.has(id))));
  if (hit) {
    const rules = hit.signals.map((s: any) => s.rule).join(' + ');
    console.log(`\nCAUGHT: alert #${hit.id} (${hit.severity}) by ${rules}, ${Math.round((Date.now() - firstAt) / 1000)} s after the first payment.`);
    process.exit(0);
  }
  await sleep(3000);
}
console.log('\nMISSED: no alert referenced these payments within 3 minutes. Check that the webhook is registered and delivering.');
process.exit(2);
