# HIVE server source

This folder contains HIVE's Express API, risk engine, PayPal Sandbox client, tests, and operational scripts. The runnable Replit artifact and workspace commands are documented in [`../README.md`](../README.md).

From the workspace root:

```bash
pnpm --filter @workspace/hive run dev
pnpm --filter @workspace/hive run test
pnpm --filter @workspace/hive run typecheck
```

The preview defaults to synthetic in-memory data. PayPal Sandbox requests, webhook delivery, and database mode are not considered verified until the steps in [`docs/GO_LIVE.md`](docs/GO_LIVE.md) pass.
