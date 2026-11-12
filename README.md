# HIVE source bundle

This archive contains the complete HIVE web/API project and the two shared workspace libraries it imports. It includes the full HIVE guide at [`artifacts/hive/README.md`](artifacts/hive/README.md), tests, Postman collection, operational docs, and blank environment-variable templates. It excludes credentials, `.env` files, user data, `node_modules`, and built output.

## Run the safe local demo

Requirements: Node.js 20+ and pnpm 10+.

```bash
pnpm install
cp artifacts/hive/hive-server/.env.example artifacts/hive/hive-server/.env
PORT=5173 BASE_PATH=/ HIVE_API_PORT=23028 pnpm --filter @workspace/hive run dev
```

Open `http://localhost:5173/`. The default local run uses synthetic data. For real PayPal Sandbox or Vertex AI calls, configure your own credentials in a local secret store or the ignored `.env` file; do not commit or share it. The full guide documents what is verified, what is still pending, and how the top admin-token notice works in persistent mode.
