/**
 * Registers HIVE's webhook with PayPal and prints the id for HIVE_PAYPAL_WEBHOOK_ID.
 * Usage: pnpm --filter @workspace/hive run webhook:register -- https://your-public-host
 * Not yet run against the sandbox. You can also create the webhook by hand in the developer dashboard.
 */
import { getAccessToken } from '../src/paypal/client.js';
import { config } from '../src/config.js';

const base = process.argv[2];
if (!base || !base.startsWith('https://')) {
  console.error('Give the public HTTPS base URL of your deployed app.');
  process.exit(1);
}
const basePath = (process.env.BASE_PATH ?? '/hive/').replace(/\/+$/, '');
const webhookPath = `${basePath === '/' ? '' : basePath}/webhooks/paypal`;
const url = new URL(webhookPath, base).toString();
const token = await getAccessToken();
const res = await fetch(`${config.PAYPAL_BASE_URL}/v1/notifications/webhooks`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url,
    event_types: ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED'].map((name) => ({ name })),
  }),
});
const body: any = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Registration failed (${res.status}):`, JSON.stringify(body).slice(0, 500));
  console.error('If the URL already exists, open the webhook in the developer dashboard and copy its id.');
  process.exit(1);
}
console.log(`Registered ${url}\nHIVE_PAYPAL_WEBHOOK_ID=${body.id}`);
