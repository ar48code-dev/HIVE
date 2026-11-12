import { demoMode } from './config.js';
import { MemoryRepo, PgRepo, type Repo } from './repo.js';
import { defaultLlm } from './ai/llm.js';

export const repo: Repo = demoMode ? new MemoryRepo() : new PgRepo();
export const llm = defaultLlm();
export { demoMode };
