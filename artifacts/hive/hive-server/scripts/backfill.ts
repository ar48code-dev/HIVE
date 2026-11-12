/** Pull PayPal Transaction Search history into the database. Use: pnpm --filter @workspace/hive run backfill -- 30 */
import { backfill } from '../src/backfill.js';
import { PgRepo } from '../src/repo.js';
import { pool } from '../src/db.js';

const days = Number(process.argv[2] ?? 30);
const r = await backfill(new PgRepo(), days);
console.log(r);
if (r.fetched > 0 && r.mapped === 0) console.log('Nothing mapped. Print one raw item and adjust src/backfill.ts (searchItemToTxn).');
await pool.end();
