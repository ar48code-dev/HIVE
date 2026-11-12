import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryRepo } from '../src/repo.js';
import { seedDemo } from '../src/demo/seed.js';
import { askQueen, buildContext } from '../src/ai/queen.js';
import type { LlmClient } from '../src/ai/llm.js';

const repo = new MemoryRepo();
beforeAll(async () => { await seedDemo(repo, Date.UTC(2026, 10, 12)); });

const fake = (replies: string[]): LlmClient & { calls: number } => {
  const f = { name: 'gemini', calls: 0, async generateJson() { return replies[Math.min(f.calls++, replies.length - 1)] as string; } };
  return f;
};

async function someEvidence() {
  const ctx = await buildContext(repo, 'How did I do this month?');
  const ids = [...ctx.allowed.keys()].slice(0, 2);
  return { ctx, ids };
}

describe('Queen AI guardrails', () => {
  it('demo data produces grouped alerts, one per incident', async () => {
    const alerts = await repo.listAlerts();
    expect(alerts.length).toBeGreaterThan(2);
    expect(alerts.length).toBeLessThan(40);
    const cardTesting = alerts.filter((a) => a.signals.some((s) => s.rule === 'CARD_TESTING'));
    expect(cardTesting.length).toBe(1);
    // A refund-abuse pattern that unfolds over several days is still one incident.
    // (Ground truth: the planted attack's transactions carry a label.)
    const all = await repo.listTxns(0);
    const planted = new Set(all.filter((t) => t.label?.attack === 'refund_abuse').map((t) => t.id));
    const touching = alerts.filter((a) => a.signals.some((s) => s.evidenceIds.some((id) => planted.has(id))));
    expect(planted.size).toBeGreaterThan(0);
    expect(touching.length).toBe(1);
  });

  it('answers from templates with no model, and every claim cites known transactions', async () => {
    const a = await askQueen(repo, null, 'Why did my money change this month?');
    expect(a.mode).toBe('template');
    expect(a.claims.length).toBeGreaterThan(0);
    for (const c of a.claims) expect(c.evidenceIds.length).toBeGreaterThan(0);
    expect(a.validation.checkedTransactions).toBeGreaterThan(0);
  });

  it('accepts a well-formed, grounded model answer', async () => {
    const { ids } = await someEvidence();
    const good = JSON.stringify({ answer: 'Things look steady.', claims: [{ text: 'These payments were recorded.', evidenceIds: ids }], confidence: 'medium', insufficientData: false });
    const llm = fake([good]);
    const a = await askQueen(repo, llm, 'How did I do?');
    expect(a.mode).toBe('gemini');
    expect(a.validation.fellBack).toBe(false);
    expect(llm.calls).toBe(1);
  });

  it('rejects an answer that cites an invented transaction, retries, then falls back', async () => {
    const bad = JSON.stringify({ answer: 'Fraud found.', claims: [{ text: 'See this payment.', evidenceIds: ['pp-DOES-NOT-EXIST'] }], confidence: 'high', insufficientData: false });
    const llm = fake([bad, bad]);
    const a = await askQueen(repo, llm, 'Any fraud?');
    expect(llm.calls).toBe(2);
    expect(a.validation.fellBack).toBe(true);
    expect(a.validation.retried).toBe(true);
    expect(a.mode).toBe('template');
    expect(a.validation.issues.join(' ')).toMatch(/unknown transaction/);
  });

  it('rejects dollar figures that are not in the facts', async () => {
    const { ids } = await someEvidence();
    const bad = JSON.stringify({ answer: 'You lost $987,654.32 this month.', claims: [{ text: 'Cited.', evidenceIds: ids }], confidence: 'high', insufficientData: false });
    const a = await askQueen(repo, fake([bad, bad]), 'Summary?');
    expect(a.validation.fellBack).toBe(true);
    expect(a.validation.issues.join(' ')).toMatch(/does not appear in the facts/);
  });

  it('recovers when the retry fixes the problem', async () => {
    const { ids } = await someEvidence();
    const bad = JSON.stringify({ answer: 'x', claims: [{ text: 'no evidence', evidenceIds: [] }], confidence: 'low', insufficientData: false });
    const good = JSON.stringify({ answer: 'Fixed.', claims: [{ text: 'Now cited.', evidenceIds: ids }], confidence: 'low', insufficientData: false });
    const a = await askQueen(repo, fake([bad, good]), 'Summary?');
    expect(a.validation.retried).toBe(true);
    expect(a.validation.fellBack).toBe(false);
    expect(a.mode).toBe('gemini');
  });

  it('survives a model that throws or returns junk', async () => {
    const llm: LlmClient = { name: 'gemini', async generateJson() { throw new Error('network down'); } };
    const a = await askQueen(repo, llm, 'Summary?');
    expect(a.validation.fellBack).toBe(true);
    expect(a.claims.length).toBeGreaterThan(0);
    const junk = await askQueen(repo, fake(['not json at all']), 'Summary?');
    expect(junk.validation.fellBack).toBe(true);
  });

  it('refuses to forecast and never calls the model for it', async () => {
    const llm = fake(['{}']);
    const a = await askQueen(repo, llm, 'Forecast my income next month');
    expect(a.insufficientData).toBe(true);
    expect(llm.calls).toBe(0);
  });

  it('writes a real 7-day report, not the 30-day summary', async () => {
    const a = await askQueen(repo, null, 'Write my weekly report');
    expect(a.answer).toMatch(/^Weekly report/);
    expect(a.claims.some((c) => /this week/i.test(c.text))).toBe(true);
    expect(a.claims.some((c) => /alert/i.test(c.text))).toBe(true);
    for (const c of a.claims) expect(c.evidenceIds.length).toBeGreaterThan(0);
  });

  it('leads with the topic the question is about', async () => {
    const a = await askQueen(repo, null, 'Which customer matters most to my revenue?');
    expect(a.claims[0]?.text).toMatch(/of 30-day revenue/);
  });

  it('investigates a specific alert from its own evidence', async () => {
    const alerts = await repo.listAlerts();
    const dup = alerts.find((x) => x.signals.some((s) => s.rule === 'DUPLICATE_PAYMENT'))!;
    const a = await askQueen(repo, null, 'Investigate this alert', dup.id);
    expect(a.answer).toContain(`#${dup.id}`);
    expect(a.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it('quotes untrusted notes only as inert data', async () => {
    const ctx = await buildContext(repo, 'Summary?');
    expect(ctx.prompt).not.toMatch(/[<>]/);
  });
});

describe('Proposed actions', () => {
  it('proposes a refund draft for a duplicate payment, never executed without a decision', async () => {
    const alerts = await repo.listAlerts();
    const dup = alerts.find((x) => x.signals.some((s) => s.rule === 'DUPLICATE_PAYMENT'))!;
    const actions = await repo.listActions(dup.id);
    expect(actions.map((a) => a.type).sort()).toEqual(['evidence_packet', 'refund_draft']);
    for (const a of actions) expect(a.status).toBe('proposed');
    const draft = actions.find((a) => a.type === 'refund_draft')!;
    expect(draft.payload.simulated).toBe(true);
  });
});
