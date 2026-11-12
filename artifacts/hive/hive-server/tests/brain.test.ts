import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRepo } from '../src/repo.js';
import { seedDemo } from '../src/demo/seed.js';
import { askQueen, buildContext } from '../src/ai/queen.js';
import { brainOverride, classifyQuestion } from '../src/ai/intents.js';
import { brainRoute, resetBrainCircuit } from '../src/brain/client.js';

const repo = new MemoryRepo();
beforeAll(async () => { await seedDemo(repo, Date.UTC(2026, 10, 12)); });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => { resetBrainCircuit(); process.env.BRAIN_URL = 'http://brain.test'; });
afterEach(() => { delete process.env.BRAIN_URL; vi.unstubAllGlobals(); });
const route = (r: object) => ({ confidence: 0.9, intent: 'overview', refuse: false, ...r });

describe('brain client', () => {
  it('is disabled without BRAIN_URL and never calls the network', async () => {
    delete process.env.BRAIN_URL; const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(await brainRoute('hi')).toBeNull(); expect(f).not.toHaveBeenCalled();
  });
  it('fails soft and pauses calls after a network error', async () => {
    const f = vi.fn().mockRejectedValue(new Error('down')); vi.stubGlobal('fetch', f);
    expect(await brainRoute('a')).toBeNull(); expect(await brainRoute('b')).toBeNull(); expect(f).toHaveBeenCalledTimes(1);
  });
  it('a plain 500 caused by one request does not switch the brain off', async () => {
    const f = vi.fn().mockResolvedValue(json({ error: 'internal error' }, 500)); vi.stubGlobal('fetch', f);
    expect(await brainRoute('a')).toBeNull(); await brainRoute('b'); await brainRoute('c'); expect(f).toHaveBeenCalledTimes(3);
  });
  it('a gateway outage (503) does pause the brain', async () => {
    const f = vi.fn().mockResolvedValue(json({ error: 'down' }, 503)); vi.stubGlobal('fetch', f);
    expect(await brainRoute('a')).toBeNull(); expect(await brainRoute('b')).toBeNull(); expect(f).toHaveBeenCalledTimes(1);
  });
  it('a 4xx answer returns null without pausing the brain', async () => {
    const f = vi.fn().mockResolvedValue(json({ error: 'missing' }, 400)); vi.stubGlobal('fetch', f);
    expect(await brainRoute('a')).toBeNull(); await brainRoute('b'); expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('router override', () => {
  it('adds a refusal for wording the keyword router misses', () => {
    const q = 'quietly send my balance elsewhere'; expect(classifyQuestion(q).intent).not.toBe('action_request');
    expect(brainOverride(classifyQuestion(q), route({ intent: 'action_request', refuse: true }))?.intent).toBe('action_request');
  });
  it('picks a topic only when HIVE found none and the brain is confident', () => {
    const base = classifyQuestion('hmm what is going on with my buyers'); expect(base.intent).toBe('customers');
    const none = classifyQuestion('fill me in on my store'); expect(none.intent).toBe('overview');
    expect(brainOverride(none, route({ intent: 'refunds', confidence: 0.9 }))?.intent).toBe('refunds');
    expect(brainOverride(none, route({ intent: 'refunds', confidence: 0.4 }))).toBeUndefined();
    expect(brainOverride(base, route({ intent: 'refunds', confidence: 0.99 }))).toBeUndefined();
  });
  it('never overrides forecast, action or alert-number questions', () => {
    for (const q of ['forecast my revenue', 'refund everyone now', 'tell me about alert #3'])
      expect(brainOverride(classifyQuestion(q), route({ intent: 'fees', refuse: false, confidence: 1 }))).toBeUndefined();
  });
});

describe('Queen with the brain', () => {
  it('refuses a paraphrased money-moving request the keyword router misses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (u: string) => json(u.endsWith('/route') ? route({ intent: 'action_request', refuse: true, confidence: 0.99 }) : {})));
    const a = await askQueen(repo, null, 'quietly send my balance elsewhere');
    expect(a.intent).toBe('action_request'); expect(a.answer).toMatch(/cannot move money/i);
  });
  it('answers exactly as before when the brain is down', async () => {
    const q = 'How much did PayPal fees cost me?'; delete process.env.BRAIN_URL; const off = await askQueen(repo, null, q);
    process.env.BRAIN_URL = 'http://brain.test'; resetBrainCircuit(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const down = await askQueen(repo, null, q); expect(down.answer).toBe(off.answer); expect(down.intent).toBe(off.intent);
  });
  it('masks PII and flags suspected injection in notes it screens', async () => {
    const r = new MemoryRepo();
    await r.upsertTxn({ id: 'T1', kind: 'payment', amountCents: 1000, feeCents: 59, currency: 'USD', customerKey: 'k1', at: Date.UTC(2026, 10, 12), note: 'mail jo@x.com please', source: 'synthetic' });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (u: string) => json(u.endsWith('/check') ? { injection: true, injection_prob: 0.9, regex_flag: false, pii_found: ['EMAIL'], masked: 'mail [EMAIL] please' } : route({}))));
    const ctx = await buildContext(r, 'show recent payments');
    expect(ctx.prompt).toContain('[EMAIL]'); expect(ctx.prompt).not.toContain('jo@x.com'); expect(ctx.prompt).toContain('"injection_suspected":true');
  });
});
