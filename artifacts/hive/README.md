# HIVE

**An evidence-first PayPal risk investigation workspace for small merchants.**

HIVE monitors payment activity, detects suspicious patterns with deterministic rules, links every alert to the transactions behind it, and prepares actions for a person to review. Wasp Lab generates labelled synthetic attacks so the detection engine can be measured and its misses shown.

## What the project does

- **Risk detection:** rule-based alerts for card testing (fast and slow), duplicate charges, refund patterns, failed-payment streaks, unusually large orders, and concentration changes.
- **Evidence-linked investigation:** Queen answers questions using server-computed facts and known transaction IDs. Answers that cite unknown IDs or unsupported dollar amounts are rejected; templates remain available as a fallback.
- **Wasp Lab:** repeatable synthetic attacks, ordinary-but-unusual activity, and a scorecard showing catches and misses.
- **Human-controlled actions:** refund drafts and evidence packets require explicit review. The demo simulates money movement.
- **Merchant workspace:** Hive overview, Wasp Radar, Queen, Customers, Analytics, Calendar estimates, Shop, Studio, Audit, and an animated landing page with 18 decorative patrol bees. Payment bees and alert wasps remain tied to transaction and alert records.
- **Optional learned second opinion:** a local model can add risk hints but does not raise alerts or replace the deterministic engine.

## What is real, simulated, and not verified

| Area | Current state |
|---|---|
| Demo activity | Synthetic transactions in memory; resets when the server restarts. Detection and investigation code are real. |
| Wasp Lab scores | Reproducible results on author-generated synthetic data; not measured real-world fraud rates or a guarantee of fraud prevention. |
| Gemini | Vertex AI is the intended provider. The connection and Studio tool continuation were verified in the current Replit workspace. The downloadable source contains no Google credentials; requests are billed to the configured Google Cloud project. |
| PayPal | Sandbox OAuth is verified. Buyer approval, capture, and webhook delivery still need the owner's Sandbox buyer test. HIVE's own completed captures are recorded directly and later webhooks are deduplicated. |
| Persistent storage | PostgreSQL schema is initialized on HIVE's dedicated database, and the development preview uses it. No buyer payment has been verified yet. Production remains demo-only. |
| External actions | Demo-mode actions are simulated. Do not describe a synthetic payment or refund as a PayPal transaction. |

## Run the demo

This source archive includes HIVE and the shared workspace packages it imports. It does not include `node_modules`, credentials, or user data.

Requirements: Node.js 20 or newer and pnpm 10 or compatible.

From the extracted archive root:

```bash
pnpm install
cp artifacts/hive/hive-server/.env.example artifacts/hive/hive-server/.env
PORT=5173 BASE_PATH=/ HIVE_API_PORT=23028 \
  pnpm --filter @workspace/hive run dev
```

Open `http://localhost:5173/`. The safe demo starts with synthetic data and no database. Keep `DEMO_MODE=true` (or leave `DATABASE_URL` empty) for that mode. In this Replit workspace, HIVE's development workflow stays demo-only unless `HIVE_LIVE_MODE=true`; then it maps only the HIVE database secret into the HIVE process. The published artifact remains demo-only. Never put credentials in source or share a `.env` file.

In persistent mode, the yellow admin-token notice at the top is expected. Viewing remains open, but approving actions, changing alert status, or running protected operations requires `ADMIN_TOKEN`. Enter it in the password field to unlock those actions; never paste it into chat or commit it. The public demo stays in synthetic demo mode and does not require this token.

Useful checks:

```bash
pnpm exec tsc --build lib/api-client-react
pnpm --filter @workspace/hive run test
pnpm --filter @workspace/hive run typecheck
pnpm --filter @workspace/hive run wasplab
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/hive run build
```

In this workspace the Replit artifact is served at `/hive/`; this archive's local command uses `/`.

## Optional integrations

Set values through Replit Secrets or another secret manager. `.env.example` files are blank templates, not credentials.

### Gemini through Vertex AI

Set `GCP_PROJECT_ID`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_SERVICE_ACCOUNT_JSON`, and optionally `GEMINI_MODEL`. Enable Vertex AI and grant the service account the Vertex AI User role. Model requests are billed to that Google Cloud project. Without Vertex AI, HIVE uses deterministic answer templates.

### PayPal Sandbox

HIVE is Sandbox-only and rejects a non-Sandbox PayPal API host. Configure `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `HIVE_PAYPAL_WEBHOOK_ID` only after creating a Sandbox REST app and registering the webhook at the public HIVE path ending in `/hive/webhooks/paypal`. Use a separate Sandbox Personal buyer account from the Business seller.

Before enabling persistent HIVE development mode:

1. Provision a database dedicated to HIVE and save it as `HIVE_DATABASE_URL`.
2. Set a strong `ADMIN_TOKEN`; non-demo mode refuses to start without it.
3. Set a long random `CUSTOMER_HASH_SALT`.
4. Initialize the schema with `pnpm --filter @workspace/hive run db:init`.
5. Register the Sandbox webhook for the HIVE HTTPS callback and save its ID as `HIVE_PAYPAL_WEBHOOK_ID`.
6. Set `HIVE_LIVE_MODE=true` in the development environment and restart the workflow. Use Shop → Sandbox test item ($1) with a separate Sandbox Personal buyer. OAuth success alone does not verify buyer approval or capture.

See [`hive-server/docs/GO_LIVE.md`](hive-server/docs/GO_LIVE.md) for the full checklist. Do not use production PayPal credentials.

### Email alerts and optional model services

Set values through Replit environment variables or another configuration manager. `.env.example` files are blank templates, not credentials.

#### HIVE alerts through Gmail

- Connect the Gmail app-code integration in Replit. HIVE uses Gmail's `gmail.send` permission only; it does not read the inbox or edit labels.
- Set `HIVE_ALERT_EMAIL_TO` to the inbox that should receive HIVE alerts. `HIVE_ALERT_MIN_SEVERITY` defaults to `medium`.
- In **Connections**, choose **Send Gmail test email**. This sends a real email to the configured recipient, with no payment or customer data.
- New or worsening medium/high alerts are emailed once per alert/severity level. Delivery errors do not block payment or alert processing.

- `BRAIN_URL` and `BRAIN_TOKEN` enable the optional Python brain service.
- `AGENT_TOKEN` protects the MCP Agent Gate outside demo mode.
- `AG_STUDIO_LICENSE` controls the AG Studio trial/license notice.

## Sponsor tools and honest status

| Tool | Project use | Status / requirement |
|---|---|---|
| PayPal | Sandbox checkout, payment capture, webhooks, transaction search, approval-gated refunds | OAuth verified; buyer approval and webhook delivery still need a buyer test. |
| Gemini via Vertex AI | Queen answers and AG Studio report assistant | Verified in the current workspace; archive requires the user's own GCP configuration. |
| AG Grid / AG Charts | Transaction and customer analysis | Included in the dashboard. |
| AG Studio | Editable report/dashboard surface and evidence queue | Included; its natural-language report assistant is limited to synthetic demo mode. A valid trial/license may be needed to remove the notice. |
| Bryntum Calendar | Estimated recurring payments | Included with the trial package; verify licensing before non-hackathon use. |
| Postman | API collection at `hive-server/postman/hive.postman_collection.json` | Included. |
| Zapier | Optional workflow tools | Not used for HIVE alerts; direct Gmail delivery avoids Zapier's premium Webhooks trigger. |
| APIMatic | No verified project integration claimed | Do not claim sponsor-tool use or eligibility based only on this README. |
| Render | No deployment included | This archive is source, not a published Render service. |

## Tests, docs, and submission notes

- `hive-server/docs/GO_LIVE.md` — Sandbox and database checklist.
- `hive-server/docs/METHODOLOGY.md` — risk rules and evaluation limits.
- `hive-server/docs/MOTION.md` — animation behavior and accessibility.
- `hive-server/docs/DEVPOST.md` — submission draft and demo script.
- `hive-server/docs/SUBMISSION_CHECKLIST.md` — rules checklist.
- `hive-server/postman/hive.postman_collection.json` — API requests.

The included tests exercise the rule engine, synthetic scenarios, evidence validation, and API protections. They do not prove live payment processing, production security, or fraud-detection performance on real merchant data.

## Safety

Keep PayPal Sandbox credentials, Google service-account JSON, database URLs, admin tokens, and webhook secrets in a secret manager. Never commit `.env`, show secrets in screenshots, or put them in a public repository. HIVE is an investigation aid, not financial advice and not a guarantee that fraud will be caught.

## License

MIT. See [`LICENSE`](LICENSE).
