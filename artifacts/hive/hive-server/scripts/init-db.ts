import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from '../src/db.js';

await pool.query(readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf8'));
console.log('schema applied');
await pool.end();
