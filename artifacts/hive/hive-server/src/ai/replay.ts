import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Recorded answers from real model runs, used only when the model is unavailable.
 * They are re-validated against current data before use (see askQueen) and shown to the person as "recorded".
 */
const FILE = join(process.cwd(), 'data', 'replay', 'queen.json');
let cache: Record<string, unknown> | null = null;

const load = (): Record<string, unknown> => {
  if (cache) return cache;
  try { cache = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}; } catch { cache = {}; }
  return cache!;
};

export const lookupReplay = (key: string): unknown | null => load()[key] ?? null;

export function saveReplay(key: string, answer: unknown): void {
  const all = load();
  all[key] = answer;
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(all, null, 2));
  } catch (err) {
    console.warn('could not save replay answer', (err as Error).message);
  }
}
