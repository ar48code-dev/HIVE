import { describe, expect, it } from 'vitest';
import { StudioContextStore, type PreservedStudioTurn } from '../src/ai/studio-context.js';

const turn = (id: string): PreservedStudioTurn => ({
  id,
  content: {
    role: 'model',
    parts: [{ functionCall: { name: 'viewSchema', args: {} }, thoughtSignature: 'opaque-signature' }],
  },
  calls: [{ callId: `call-${id}`, name: 'viewSchema' }],
});

describe('Studio Gemini context', () => {
  it('preserves provider parts without relying on client-supplied signatures', () => {
    const store = new StudioContextStore();
    const original = turn('one');
    store.remember(original, ['output-one']);
    original.content.parts[0]!.thoughtSignature = 'changed';
    expect(store.resolve('output-one')?.content.parts[0]?.thoughtSignature).toBe('opaque-signature');
    expect(store.resolve(undefined, 'call-one')?.id).toBe('one');
  });

  it('expires old turns and removes every lookup anchor', () => {
    let now = 0;
    const store = new StudioContextStore(100, 2, () => now);
    store.remember(turn('one'), ['output-one']);
    now = 101;
    expect(store.resolve('output-one')).toBeUndefined();
    expect(store.resolve(undefined, 'call-one')).toBeUndefined();
  });

  it('bounds stored turns instead of retaining public conversations indefinitely', () => {
    const store = new StudioContextStore(1000, 1, () => 0);
    store.remember(turn('one'), ['output-one']);
    store.remember(turn('two'), ['output-two']);
    expect(store.resolve('output-one')).toBeUndefined();
    expect(store.resolve(undefined, 'call-one')).toBeUndefined();
    expect(store.resolve('output-two')?.id).toBe('two');
  });
});
