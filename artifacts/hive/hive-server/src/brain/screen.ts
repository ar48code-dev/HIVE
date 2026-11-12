import { brainCheck, brainEnabled } from './client.js';
import type { Txn } from '../types.js';

export interface NoteScreen { suspected: boolean; masked: string; pii: string[] }

/** Screens untrusted payment notes with the brain: masks PII and flags likely injection. Empty map when the brain is off or down. */
export async function screenNotes(txns: Txn[]): Promise<Map<string, NoteScreen>> {
  const out = new Map<string, NoteScreen>();
  if (!brainEnabled()) return out;
  await Promise.all(txns.filter((t) => t.note).slice(0, 60).map(async (t) => {
    const r = await brainCheck(t.note!);
    if (r) out.set(t.id, { suspected: r.injection, masked: r.masked, pii: r.pii_found });
  }));
  return out;
}
