import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { ingestCapturedOrder, webhookHandler } from './webhooks.js';
import { sendTestEmail } from './notify.js';
import { captureOrder, createOrder, getAccessToken } from './paypal/client.js';
import { parseCheckoutCreateInput } from './paypal/checkout.js';
import { repo, llm, demoMode } from './runtime.js';
import { MemoryRepo } from './repo.js';
import { seedDemo } from './demo/seed.js';
import { alias, customerRows, summarize } from './analytics.js';
import { detectRecurring } from './recurring.js';
import { growth } from './growth.js';
import { backfill } from './backfill.js';
import { SIM_ATTACKS, simulate, type SimAttack } from './demo/inject.js';
import { DAY } from './risk/engine.js';
import { askQueen } from './ai/queen.js';
import { InvalidStudioTurnRequestError, runStudioTurn } from './ai/studio-agent.js';
import { SUGGESTED_QUESTIONS } from './ai/intents.js';
import { timingSafeEqual } from 'node:crypto';
import { sanitizeUntrusted } from './ai/sanitize.js';
import { brainCall, brainEnabled, brainScore, toBrainTxn } from './brain/client.js';
import { applicability, nativeScore, riskModelAvailable } from './brain/risk.js';
import { executeAction } from './actions.js';
import { executeOp, sendInvoiceOp, listDisputeCases, prepareDisputeResponse, validatePayout, validateInvoice, invoiceSuggestions, payoutUsedCents, maskEmail } from './features/ops.js';
import { handleRpc, TOOLS } from './agent/mcp.js';
import { runAll } from './wasplab/evaluate.js';
import type { Txn } from './types.js';
import { vertexAIConfigured } from '@workspace/integrations-gemini-ai';

const app = express();
app.disable('x-powered-by');
// Deployment proxies sit in front of the server. Trust one hop so rate limits can use the visitor IP.
app.set('trust proxy', 1);
const basePath = (process.env.BASE_PATH ?? '').replace(/\/$/, '');
if (basePath && basePath !== '/') {
  app.use((req, _res, next) => {
    if (req.url === basePath || req.url.startsWith(`${basePath}/`)) {
      req.url = req.url.slice(basePath.length) || '/';
    }
    next();
  });
}
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// Raw body for the webhook route so the payload is parsed exactly once, here.
app.post('/webhooks/paypal', express.raw({ type: '*/*', limit: '1mb' }), webhookHandler);

app.use(express.json({ limit: '50kb' }));

// Small in-memory rate limiter so a public demo cannot burn the AI budget.
const hits = new Map<string, number[]>();
const limit = (perMinute: number) => (req: Request, res: Response, next: NextFunction) => {
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= perMinute) return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
  next();
};

/** State-changing routes need ADMIN_TOKEN when one is configured. With none set (demo mode) they stay open. */
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!config.ADMIN_TOKEN) return next();
  const given = String(req.headers['x-admin-token'] ?? '');
  const a = Buffer.from(given), b = Buffer.from(config.ADMIN_TOKEN);
  if (a.length === b.length && timingSafeEqual(a, b)) return next();
  res.status(401).json({ error: 'This action needs the access token from the README. Enter it in the banner at the top of the page.' });
};

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

app.get('/api/mode', (_req, res) => res.json({ demo: demoMode, ai: llm ? llm.name : 'template', authRequired: !!config.ADMIN_TOKEN, brain: brainEnabled(), secondOpinion: riskModelAvailable() || brainEnabled() }));

// The web app calls this to check a token before enabling approval buttons.
app.post('/api/auth/check', requireAdmin, (_req, res) => res.json({ ok: true }));

app.get('/api/queen/suggestions', wrap(async (_req, res) => {
  const open = (await repo.listAlerts()).filter((a) => a.status === 'open').sort((a, b) => b.score - a.score).slice(0, 2);
  res.json([...SUGGESTED_QUESTIONS, ...open.map((a) => `Why was alert #${a.id} raised?`)]);
}));

// The PayPal client id is public by design (it is embedded in the browser SDK URL). The secret never leaves the server.
// What is connected, and (with ?test=1) whether each live service actually answers. Never returns secret values.
app.get('/api/connections', limit(10), wrap(async (req, res) => {
  const test = req.query.test === '1';
  const testPaypal = test || req.query.test === 'paypal';
  const testGemini = test || req.query.test === 'gemini';
  const paypalSet = !!(config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET);
  const items: Array<{ id: string; name: string; state: 'live' | 'configured' | 'missing' | 'error'; detail: string; fix?: string }> = [];
  let pp: { state: 'live' | 'configured' | 'missing' | 'error'; detail: string } = paypalSet ? { state: 'configured', detail: 'Sandbox keys are set. Press "Test connections" to check them.' } : { state: 'missing', detail: 'No sandbox keys. Hive runs on synthetic demo data.' };
  if (paypalSet && testPaypal) {
    try { await getAccessToken(); pp = { state: 'live', detail: 'PayPal sandbox accepted the keys.' }; } catch (e) { pp = { state: 'error', detail: (e as Error).message.slice(0, 160) }; }
  }
  const paypalFix = pp.state === 'live' ? undefined : pp.state === 'configured'
    ? 'Press “Test connections” to verify the Sandbox app credentials.'
    : 'Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET from the Sandbox app in PayPal Developer Dashboard.';
  items.push({ id: 'paypal', name: 'PayPal sandbox (Orders, Refunds, Transaction Search)', ...pp, fix: paypalFix });
  items.push({
    id: 'webhook',
    name: 'PayPal webhook',
    state: config.HIVE_PAYPAL_WEBHOOK_ID ? 'configured' : 'missing',
    detail: config.HIVE_PAYPAL_WEBHOOK_ID
      ? 'HIVE-specific webhook ID is set, but delivery has not been verified.'
      : 'No HIVE webhook ID. New payments will not arrive on their own.',
    fix: config.HIVE_PAYPAL_WEBHOOK_ID
      ? 'Confirm the Sandbox callback matches this HIVE public URL, then complete a buyer-approved test capture.'
      : 'Register a Sandbox webhook at your public /hive/webhooks/paypal URL, then save its ID as HIVE_PAYPAL_WEBHOOK_ID.',
  });
  items.push({
    id: 'email',
    name: 'Gmail alert delivery',
    state: config.HIVE_ALERT_EMAIL_TO ? 'configured' : 'missing',
    detail: config.HIVE_ALERT_EMAIL_TO
      ? 'A recipient is set. HIVE sends through Gmail with send-only permission; send a test email to verify delivery.'
      : 'Alert rules are ready, but no email recipient is configured.',
    fix: config.HIVE_ALERT_EMAIL_TO ? undefined : 'Set HIVE_ALERT_EMAIL_TO to the inbox that should receive alerts.',
  });
  const vertexConfigured = vertexAIConfigured();
  let ai: { state: 'live' | 'configured' | 'missing' | 'error'; detail: string } = vertexConfigured ? { state: 'configured', detail: `Vertex AI Gemini model ${config.GEMINI_MODEL} is configured in your Google Cloud project.` } : { state: 'missing', detail: 'Vertex AI Gemini is not configured. HIVE uses rule-based templates.' };
  if (vertexConfigured && testGemini && llm) {
    try { const t = await llm.generateJson('Reply with JSON only.', 'Return {"ok":true}'); ai = JSON.parse(t)?.ok ? { state: 'live', detail: `Vertex AI Gemini ${config.GEMINI_MODEL} answered; usage is billed to your Google Cloud project.` } : { state: 'error', detail: 'Vertex AI Gemini answered, but not in the expected shape.' }; } catch (e) { ai = { state: 'error', detail: (e as Error).message.slice(0, 160) }; }
  }
  const geminiFix = ai.state === 'live' ? undefined : ai.state === 'configured'
    ? 'Press “Test connections” to send a small Vertex AI model request. Google Cloud may bill for usage.'
    : 'Set GCP_PROJECT_ID, GOOGLE_CLOUD_LOCATION, and GOOGLE_SERVICE_ACCOUNT_JSON. Enable Vertex AI API and grant the service account Vertex AI User access.';
  items.push({ id: 'gemini', name: 'Gemini (Vertex AI)', ...ai, fix: geminiFix });
  items.push({ id: 'db', name: 'PostgreSQL', state: config.DATABASE_URL ? 'configured' : 'missing', detail: config.DATABASE_URL ? 'DATABASE_URL set.' : 'No database. Data lives in memory and resets on restart (demo mode).', fix: config.DATABASE_URL ? undefined : 'Configure a dedicated HIVE database, then run: pnpm --filter @workspace/hive run db:init' });
  items.push({ id: 'brain', name: 'Learned second opinion (brain)', state: brainEnabled() ? 'configured' : 'missing', detail: brainEnabled() ? 'BRAIN_URL set.' : 'Optional. Rule engine and built-in model still work.' });
  items.push({ id: 'agent', name: 'Agent Gate (MCP)', state: config.AGENT_TOKEN ? 'live' : demoMode ? 'configured' : 'missing', detail: config.AGENT_TOKEN ? 'Agents must send the bearer token.' : demoMode ? 'Open in demo mode (synthetic data only).' : 'Off: AGENT_TOKEN is not set.', fix: config.AGENT_TOKEN || demoMode ? undefined : 'Set AGENT_TOKEN to a long random value.' });
  items.push({ id: 'auth', name: 'Admin token', state: config.ADMIN_TOKEN ? 'live' : 'missing', detail: config.ADMIN_TOKEN ? 'State-changing routes are protected.' : 'Open (fine for demo mode only).' });
  res.json({ demo: demoMode, tested: test || testPaypal || testGemini, items });
}));

app.post('/api/connections/gmail-test', requireAdmin, limit(3), wrap(async (_req, res) => {
  if (!config.HIVE_ALERT_EMAIL_TO) return res.status(409).json({ error: 'Set HIVE_ALERT_EMAIL_TO before testing email delivery.' });
  if (!await sendTestEmail()) return res.status(502).json({ error: 'Gmail did not accept the test email. Check the connected Gmail integration and configured recipient.' });
  res.json({ ok: true, detail: 'Gmail accepted the test email. No payment or customer data was sent.' });
}));

// AG Studio's dashboard assistant is available only in synthetic demo mode.
// It can query and reshape the report, but has no tools for financial actions.
app.post('/api/studio/turn', limit(20), async (req, res) => {
  if (!demoMode) return res.status(503).json({ error: 'The dashboard assistant is limited to synthetic demo data.' });
  if (!llm || llm.name !== 'gemini') return res.status(503).json({ error: 'Gemini is not enabled for HIVE.' });
  const controller = new AbortController();
  req.on('aborted', () => controller.abort());
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    res.json(await runStudioTurn(req.body, controller.signal));
  } catch (error) {
    if (error instanceof InvalidStudioTurnRequestError) {
      return res.status(400).json({ error: error.message });
    }
    const message = (error as Error).message.slice(0, 180);
    return res.status(502).json({ error: `Gemini dashboard request failed: ${message}` });
  }
});

// ===================== Disputes, Payouts, Invoices (approve-then-confirm, like refunds) =====================
const opView = (o: { payload: Record<string, unknown> } & Record<string, unknown>) => ({ ...o, payload: o.payload.email ? { ...o.payload, email: maskEmail(String(o.payload.email)) } : o.payload });

app.get('/api/disputes', limit(20), wrap(async (_req, res) => {
  try { const r = await listDisputeCases(repo); res.json({ ...r, items: r.items.map((d) => ({ ...d, response: d.response && opView(d.response as never) })) }); }
  catch (e) { res.status(502).json({ error: `Could not load disputes from PayPal: ${(e as Error).message.slice(0, 200)}` }); }
}));
app.post('/api/disputes/:id/prepare', limit(20), requireAdmin, wrap(async (req, res) => {
  const { items } = await listDisputeCases(repo);
  const d = items.find((x) => x.id === req.params.id); if (!d) return res.status(404).json({ error: 'Dispute not found.' });
  const op = await prepareDisputeResponse(repo, d);
  await repo.audit('queen-ai', 'dispute_response_prepared', { disputeId: d.id, opId: op.id, recommendation: op.payload.recommendation });
  res.json(op);
}));

app.get('/api/payouts', limit(30), wrap(async (_req, res) => {
  const ops = await repo.listOps('payout');
  res.json({ capCents: config.PAYOUT_DAILY_CAP_CENTS, usedCents: payoutUsedCents(ops), items: ops.map((o) => opView(o as never)), simulated: demoMode });
}));
app.post('/api/payouts', limit(10), requireAdmin, wrap(async (req, res) => {
  const v = validatePayout(req.body ?? {}); if (!v.ok) return res.status(400).json({ error: v.error });
  const op = await repo.createOp('payout', { email: v.email, amountCents: v.amountCents, currency: 'USD', note: v.note });
  await repo.audit('user', 'payout_proposed', { opId: op.id, amountCents: v.amountCents, to: maskEmail(v.email) });
  res.json(opView(op as never));
}));

app.get('/api/invoices', limit(30), wrap(async (_req, res) => {
  res.json({ items: (await repo.listOps('invoice')).map((o) => opView(o as never)), suggestions: await invoiceSuggestions(repo), simulated: demoMode });
}));
app.post('/api/invoices', limit(10), requireAdmin, wrap(async (req, res) => {
  const v = validateInvoice(req.body ?? {}); if (!v.ok) return res.status(400).json({ error: v.error });
  const op = await repo.createOp('invoice', { customer: v.customer, email: v.email, amountCents: v.amountCents, currency: 'USD', description: v.description, dueDays: v.dueDays });
  await repo.audit('user', 'invoice_proposed', { opId: op.id, amountCents: v.amountCents, to: maskEmail(v.email) });
  res.json(opView(op as never));
}));
app.post('/api/ops/:id/send', limit(10), requireAdmin, wrap(async (req, res) => {
  const op = await repo.getOp(Number(req.params.id)); if (!op) return res.status(404).json({ error: 'Not found.' });
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Sending needs explicit confirmation.' });
  try {
    const out = await sendInvoiceOp(op); await repo.patchOpResult(op.id, { sent: true, sentAt: Date.now() });
    await repo.audit('user', 'invoice_sent', { opId: op.id, simulated: out.simulated });
    res.json({ ok: true, simulated: out.simulated });
  } catch (e) { res.status(409).json({ error: (e as Error).message.slice(0, 300) }); }
}));

app.post('/api/ops/:id/decision', limit(20), requireAdmin, wrap(async (req, res) => {
  const op = await repo.getOp(Number(req.params.id));
  if (!op) return res.status(404).json({ error: 'Not found.' });
  if (op.status !== 'proposed') return res.status(409).json({ error: `This is already ${op.status}.` });
  const decision = req.body?.decision;
  if (decision === 'reject') { await repo.decideOp(op.id, 'rejected', 'user'); await repo.audit('user', `${op.kind}_rejected`, { opId: op.id }); return res.json({ ok: true, status: 'rejected' }); }
  if (decision !== 'approve') return res.status(400).json({ error: 'Decision must be approve or reject.' });
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Approval needs explicit confirmation.' });
  await repo.audit('user', `${op.kind}_approved`, { opId: op.id });
  try {
    const out = await executeOp(op, repo);
    await repo.decideOp(op.id, 'executed', 'user', { simulated: out.simulated, ...out.detail });
    await repo.audit('system', `${op.kind}_executed`, { opId: op.id, simulated: out.simulated, ...out.detail });
    res.json({ ok: true, status: 'executed', simulated: out.simulated, detail: out.detail });
  } catch (err) {
    const msg = (err as Error).message.slice(0, 300);
    await repo.decideOp(op.id, 'failed', 'user', { error: msg }); await repo.audit('system', `${op.kind}_failed`, { opId: op.id, error: msg });
    res.status(502).json({ error: `The PayPal call failed: ${msg}` });
  }
}));

// ===================== Agent Gate: MCP server for other AI agents (read-only tools) =====================
const agentAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!config.AGENT_TOKEN) {
    if (demoMode) return next(); // demo data only, nothing real to protect
    return res.status(503).json({ error: 'Agent Gate is off: set AGENT_TOKEN to turn it on.' });
  }
  const given = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given), b = Buffer.from(config.AGENT_TOKEN);
  if (a.length === b.length && timingSafeEqual(a, b)) return next();
  res.status(401).json({ error: 'Missing or wrong agent token.' });
};
app.post('/mcp', limit(120), agentAuth, wrap(async (req, res) => {
  const out = await handleRpc(repo, req.body, async (tool, ok) => { await repo.audit('agent', 'agent_call', { tool, ok }); });
  if (out.body === null) return res.status(out.status).end();
  res.status(out.status).json(out.body);
}));
app.get('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').json({ error: 'Use POST with JSON-RPC 2.0.' }));
app.get('/api/agent', limit(30), wrap(async (_req, res) => {
  const audit = (await repo.listAudit(500)).filter((a) => a.event === 'agent_call').slice(0, 20);
  res.json({ endpoint: '/mcp', tokenRequired: !!config.AGENT_TOKEN, enabled: !!config.AGENT_TOKEN || demoMode, tools: TOOLS.map((t) => ({ name: t.name, description: t.description })), recent: audit });
}));

app.get('/api/config', (_req, res) => res.json({ demo: demoMode, paypalClientId: demoMode ? '' : config.PAYPAL_CLIENT_ID, currency: 'USD', agStudioLicense: config.AG_STUDIO_LICENSE }));

const latest = async () => {
  const txns = await repo.listTxns(0);
  return { txns, asOf: txns.reduce((m, t) => Math.max(m, t.at), 0) || Date.now() };
};

app.get('/api/customers', wrap(async (_req, res) => {
  const { txns, asOf } = await latest();
  res.json(customerRows(txns, asOf));
}));

app.get('/api/recurring', wrap(async (_req, res) => {
  const { txns, asOf } = await latest();
  res.json({ asOf, items: detectRecurring(txns, asOf), note: 'Estimates from payment history. They are not confirmed future payments.' });
}));

app.get('/api/growth', wrap(async (_req, res) => {
  const [audit, alerts] = await Promise.all([repo.listAudit(1000), repo.listAlerts()]);
  res.json(growth(audit, alerts.filter((a) => a.status === 'open').length));
}));

// Demo only: push a simulated event through the real engine, as an arriving webhook would.
app.post('/api/demo/simulate', limit(30), wrap(async (req, res) => {
  if (!demoMode) return res.status(403).json({ error: 'Simulation is only available in demo mode.' });
  const attack = String(req.body?.attack ?? '') as SimAttack;
  if (!(SIM_ATTACKS as readonly string[]).includes(attack)) return res.status(400).json({ error: 'Unknown scenario.' });
  res.json(await simulate(repo, attack));
}));

// Pull history from PayPal Transaction Search and merge it with what webhooks already delivered.
app.post('/api/backfill', limit(6), requireAdmin, wrap(async (req, res) => {
  if (demoMode) return res.status(503).json({ error: 'Backfill needs a PayPal connection. Demo mode has none.' });
  const days = Math.min(90, Math.max(1, Math.floor(Number(req.body?.days ?? 30))));
  res.json(await backfill(repo, days));
}));

app.get('/api/summary', wrap(async (_req, res) => {
  const { txns, asOf } = await latest();
  res.json(summarize(txns, asOf));
}));

app.get('/api/transactions', wrap(async (_req, res) => {
  const txns = await repo.listTxns(Date.now() - 400 * DAY);
  const alerts = await repo.listAlerts();
  const flags = new Map<string, Array<{ id: number; severity: string }>>();
  for (const a of alerts) for (const id of new Set(a.signals.flatMap((s) => s.evidenceIds))) {
    flags.set(id, [...(flags.get(id) ?? []), { id: a.id, severity: a.severity }]);
  }
  res.json(txns.map((t: Txn) => {
    const note = sanitizeUntrusted(t.note);
    return {
      id: t.id, kind: t.kind, amountCents: t.amountCents, feeCents: t.feeCents, currency: t.currency, at: t.at,
      customer: alias(t.customerKey), source: t.source, note: note.text, noteFlagged: note.flagged, alerts: flags.get(t.id) ?? [],
    };
  }));
}));

app.get('/api/alerts', wrap(async (_req, res) => {
  const [alerts, actions] = await Promise.all([repo.listAlerts(), repo.listActions()]);
  res.json(alerts.map((a) => ({
    ...a,
    evidenceCount: new Set(a.signals.flatMap((s) => s.evidenceIds)).size,
    pendingActions: actions.filter((x) => x.alertId === a.id && x.status === 'proposed').length,
  })));
}));

app.get('/api/alerts/:id', wrap(async (req, res) => {
  const alert = await repo.getAlert(Number(req.params.id));
  if (!alert) return res.status(404).json({ error: 'Alert not found.' });
  res.json({ alert, actions: await repo.listActions(alert.id) });
}));

app.post('/api/alerts/:id/status', requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body?.status;
  if (!['open', 'reviewed', 'dismissed'].includes(status)) return res.status(400).json({ error: 'Status must be open, reviewed or dismissed.' });
  if (!(await repo.getAlert(id))) return res.status(404).json({ error: 'Alert not found.' });
  await repo.setAlertStatus(id, status);
  await repo.audit('user', `alert_${status}`, { alertId: id });
  res.json({ ok: true });
}));

app.post('/api/queen/ask', limit(20), wrap(async (req, res) => {
  const question = String(req.body?.question ?? '').trim();
  if (!question) return res.status(400).json({ error: 'Ask a question.' });
  const alertId = req.body?.alertId ? Number(req.body.alertId) : undefined;
  const answer = await askQueen(repo, llm, question, alertId);
  await repo.audit('queen-ai', 'answered', { question: question.slice(0, 200), alertId, mode: answer.mode, claims: answer.claims.length, fellBack: answer.validation.fellBack });
  res.json(answer);
}));

app.post('/api/actions/:id/decision', limit(20), requireAdmin, wrap(async (req, res) => {
  const action = await repo.getAction(Number(req.params.id));
  if (!action) return res.status(404).json({ error: 'Action not found.' });
  if (action.status !== 'proposed') return res.status(409).json({ error: `This action is already ${action.status}.` });
  const decision = req.body?.decision;
  if (decision === 'reject') {
    await repo.decideAction(action.id, 'rejected', 'user');
    await repo.audit('user', 'action_rejected', { actionId: action.id, type: action.type });
    return res.json({ ok: true, status: 'rejected' });
  }
  if (decision !== 'approve') return res.status(400).json({ error: 'Decision must be approve or reject.' });
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Approval needs explicit confirmation.' });
  await repo.audit('user', 'action_approved', { actionId: action.id, type: action.type });
  try {
    const out = await executeAction(action);
    await repo.decideAction(action.id, 'executed', 'user', { simulated: out.simulated, ...out.detail });
    await repo.audit('system', 'action_executed', { actionId: action.id, simulated: out.simulated, ...out.detail });
    res.json({ ok: true, status: 'executed', simulated: out.simulated, detail: out.detail });
  } catch (err) {
    const msg = (err as Error).message.slice(0, 300);
    await repo.decideAction(action.id, 'failed', 'user', { error: msg });
    await repo.audit('system', 'action_failed', { actionId: action.id, error: msg });
    res.status(502).json({ error: `The PayPal action failed: ${msg}` });
  }
}));

/** Second opinion from the learned risk model. Rules stay the source of alerts; this only shows what the model flags that the rules did not. */
let secondOpinion: { key: string; at: number; body: unknown } | null = null;
app.get('/api/brain/second-opinion', limit(15), wrap(async (_req, res) => {
  if (!riskModelAvailable() && !brainEnabled()) return res.json({ enabled: false });
  const txns = (await repo.listTxns(0)).sort((a, b) => a.at - b.at);
  const alerts = await repo.listAlerts();
  const fit = applicability(txns);
  if (riskModelAvailable() && !fit.applicable) return res.json({ enabled: true, applicable: false, reason: fit.reason, scored: 0, flaggedByModel: 0, modelOnly: [] });
  // Scoring the whole history is the expensive part, so reuse the answer for 30 s unless the data changed.
  const key = `${txns.length}:${txns[txns.length - 1]?.id ?? ''}:${alerts.length}`;
  if (secondOpinion && secondOpinion.key === key && Date.now() - secondOpinion.at < 30_000) return res.json(secondOpinion.body);
  // The model runs natively inside HIVE; the Python service is only a fallback if the weights are missing.
  const scored = nativeScore(txns)?.map((s) => ({ risk: s.risk, flag_model: s.flag, why: s.why })) ?? (await brainScore(txns.map(toBrainTxn)));
  if (!scored || scored.length !== txns.length) return res.status(503).json({ enabled: true, error: 'The learned model is not reachable right now.' });
  const covered = new Set(alerts.flatMap((a) => [a.txnId, ...a.signals.flatMap((s) => s.evidenceIds)]));
  const rows = txns.map((t, i) => ({ id: t.id, at: t.at, kind: t.kind, amountCents: t.amountCents, customer: alias(t.customerKey), risk: scored[i]!.risk,
    flaggedByModel: scored[i]!.flag_model, coveredByRules: covered.has(t.id), why: scored[i]!.why }));
  const flagged = rows.filter((r) => r.flaggedByModel);
  const body = { enabled: true, scored: rows.length, flaggedByModel: flagged.length, modelOnly: flagged.filter((r) => !r.coveredByRules).slice(-25).reverse(),
    note: 'A separate learned model (logistic regression trained on simulated shops). Rules remain the source of alerts; treat these as hints, not findings.' };
  secondOpinion = { key, at: Date.now(), body };
  res.json(body);
}));

/** Policy firewall (proxied). Creating, confirming and authorizing all need the admin token: confirming is the human step. */
for (const [path, perMin] of [['create', 10], ['confirm', 10], ['authorize', 30]] as const) {
  app.post(`/api/brain/policy/${path}`, limit(perMin), requireAdmin, wrap(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const body = path === 'create' ? { text: String(b.text ?? '').slice(0, 500) } : path === 'confirm' ? { id: String(b.id ?? '') } : { id: String(b.id ?? ''), order: b.order ?? {} };
    const r = await brainCall<unknown>(`/policy/${path}`, body, 5000);
    if (r === null) return res.status(503).json({ error: 'brain unavailable or request rejected' });
    res.json(r);
  }));
}

app.get('/api/wasplab', wrap(async (_req, res) => {
  let report = await repo.latestWasplab();
  if (!report) { report = runAll(10); await repo.saveWasplab(report); }
  res.json(report);
}));

app.post('/api/wasplab/run', limit(6), wrap(async (req, res) => {
  const seeds = Math.min(30, Math.max(1, Math.floor(Number(req.body?.seeds ?? 10))));
  const report = runAll(seeds);
  await repo.saveWasplab(report);
  await repo.audit('user', 'wasplab_run', { seeds, overallRecall: report.overallRecall });
  res.json(report);
}));

app.get('/api/audit', wrap(async (_req, res) => res.json(await repo.listAudit(200))));

// Demo merchant checkout: creates a real sandbox order. The buyer approves it in PayPal.
app.post('/api/checkout/create', limit(20), wrap(async (req, res) => {
  if (demoMode) return res.status(503).json({ error: 'Checkout is disabled in demo mode.' });
  const checkout = parseCheckoutCreateInput(req.body);
  if (!checkout) return res.status(400).json({ error: 'Choose a listed Sandbox item and provide a valid checkout retry id.' });
  res.json(await createOrder(checkout.amount, 'USD', 'hive-demo', checkout.requestId));
}));

app.post('/api/checkout/capture', limit(20), wrap(async (req, res) => {
  if (demoMode) return res.status(503).json({ error: 'Checkout is disabled in demo mode.' });
  const orderId = String(req.body?.orderId ?? '');
  if (!/^[A-Z0-9]{10,30}$/.test(orderId)) return res.status(400).json({ error: 'That order id is not valid.' });
  const order = await captureOrder(orderId);
  if (order.status !== 'COMPLETED') {
    return res.status(202).json({ status: order.status ?? 'UNKNOWN', recorded: false, orderId });
  }
  try {
    res.json(await ingestCapturedOrder(orderId, order));
  } catch (error) {
    console.error('PayPal capture completed; HIVE transaction sync is pending.', error);
    res.json({
      status: 'COMPLETED',
      recorded: false,
      orderId,
      captureId: order.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? null,
      message: 'PayPal completed this Sandbox payment, but HIVE could not save it yet. Do not create another order; retry this same order to sync it.',
    });
  }
}));

// Built dashboard, when present.
const webDist = join(process.cwd(), '..', 'dist', 'public');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|webhooks|health).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

if (demoMode && repo instanceof MemoryRepo) await seedDemo(repo);

app.listen(config.PORT, () =>
  console.log(`HIVE API on :${config.PORT} (${demoMode ? 'DEMO data, in memory' : 'database'}; AI: ${llm ? llm.name : 'template'})`),
);
