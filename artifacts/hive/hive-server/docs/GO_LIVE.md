# HIVE verification and Sandbox setup

## Current verified state

- The HIVE development preview uses the HIVE-specific persistent database; its schema is initialized. No buyer-approved payment is verified yet.
- The risk engine, Wasp Lab, evidence checks, and API protections have automated tests.
- PayPal Sandbox OAuth accepted the configured app credentials.
- A Sandbox Personal buyer has not yet completed checkout or capture. A HIVE webhook ID is configured, but event delivery is unverified.
- HIVE now records completed captures from its own Shop directly, then deduplicates their later signed webhook by capture ID.
- HIVE uses Gemini 3.8 Flash through Vertex AI. A live connection check and a Studio tool-call continuation succeeded with the configured GCP credentials.
- Gmail send-only integration is connected. Gmail accepted one HIVE test message, which the recipient found in Spam; inbox placement is not verified.
- The published app is configured to remain in demo mode until its owner deliberately changes that setting.

Keep the demo label visible when using synthetic data. In persistent mode, describe activity as PayPal Sandbox; never describe simulated actions as real PayPal activity.

## Run the demo and checks

Start the HIVE artifact workflow or run:

```bash
pnpm --filter @workspace/hive run dev
```

Open the Replit preview at `/hive/`. Run the checks with:

```bash
pnpm --filter @workspace/hive run test
pnpm --filter @workspace/hive run typecheck
PORT=23027 BASE_PATH=/hive/ pnpm --filter @workspace/hive run build
pnpm --filter @workspace/hive run wasplab
```

The test command disables live Gemini calls. To verify Gemini, use **Test connections** in the app; this sends a model request and Google Cloud may bill for it. Queen uses the rule-based answer path when Vertex AI is not configured.

## Before enabling real PayPal Sandbox traffic

Do these steps only against Sandbox. HIVE rejects PayPal's live API host.

1. In PayPal Developer Dashboard, use a Sandbox business app and a separate Sandbox Personal buyer account. You can create the buyer account yourself; a second human buyer is not required.
2. Confirm the Replit Secrets store contains the Sandbox app's `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. Never paste those values into chat or commit them.
3. Provide HIVE with a database dedicated to this app. Do not point it at another artifact's tables without first isolating HIVE in its own PostgreSQL schema or database.
4. Set `ADMIN_TOKEN` to a long random value and a unique `CUSTOMER_HASH_SALT` of at least 32 characters; initialize the HIVE schema with `pnpm --filter @workspace/hive run db:init`.
5. For the Replit development preview only, set `HIVE_LIVE_MODE=true`. The startup wrapper maps `HIVE_DATABASE_URL` to that process and selects persistent mode. This does not change the published artifact's demo setting.
6. Use Connections → Test PayPal Sandbox to verify OAuth, then Shop → Sandbox test item ($1) with a separate Sandbox Personal buyer. Complete buyer approval and confirm HIVE shows the captured transaction. The checkout now reuses a retry ID for the same attempt and accepts only its four listed item prices. Do not create extra orders unless needed.

Do not enable persistent mode until the dedicated database, admin token, and unique customer-hash salt are ready. Sandbox test payments create records but do not move real money.

## Register and verify the webhook

The development webhook ID is configured, but event delivery is unverified. After publishing on its final public HTTPS URL, create a separate PayPal Sandbox webhook pointing to:

```text
https://YOUR-PUBLIC-HOST/hive/webhooks/paypal
```

Subscribe to:

- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.DENIED`
- `PAYMENT.CAPTURE.REFUNDED`
- `PAYMENT.CAPTURE.REVERSED`

Save the webhook's ID in Replit Secrets as `HIVE_PAYPAL_WEBHOOK_ID`, then restart the HIVE service. Each project needs its own webhook ID, registered in the same Sandbox app as its API credentials. A webhook simulator event is not proof of signature verification; verify with a real Sandbox buyer approval and capture.

To test the buyer flow, sign in to PayPal Checkout with the Sandbox Personal buyer account and approve a Sandbox order. Confirm the capture appears in HIVE with source `paypal`. If it does not, inspect the API logs and check the webhook ID, event subscription, and public callback URL. Do not claim the end-to-end flow until this succeeds.

## Sponsor tools in this project

- **PayPal:** OAuth verified; buyer approval, capture, and webhook delivery are still unverified. HIVE's own checkout directly stores a completed capture and deduplicates the later webhook.
- **Gemini:** Queen uses Vertex AI for evidence-bounded explanations; model output is validated before display. Google Cloud bills model usage to the configured project.
- **AG Grid and AG Charts:** transaction/customer analysis and visual summaries.
- **AG Studio:** dashboard editing surface; the natural-language report assistant is limited to synthetic demo mode; license/trial status depends on the configured license.
- **Bryntum Calendar:** recurring-payment estimates, not promised future payments; this build uses the trial package.
- **Postman:** `hive-server/postman/hive.postman_collection.json` documents API calls.
- **Gmail:** direct alert delivery through the send-only Gmail connection; the test message was accepted but landed in Spam.
- **Zapier:** not used for HIVE alerts; this avoids Zapier's premium Webhooks trigger.
- **APIMatic:** not claimed as used. Its official PayPal Context Plugin installer does not detect a supported coding editor in this Replit Agent environment; see `APIMATIC.md`.

## Demo recording

Use `hive-server/docs/DEVPOST.md`. Show Wasp Lab attacks and evidence-linked alerts with the synthetic-data label visible. Any approval in demo mode is simulated. Add the PayPal Sandbox buyer/capture scene only after the webhook and Sandbox flow have been verified. Do not show credentials, buyer passwords, or tokens.
