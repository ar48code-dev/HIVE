/**
 * Regenerate tests/fixtures/risk_parity.json: real transactions scored by the PYTHON model, so the TypeScript port can be checked against it.
 * Run after retraining:  npx tsx scripts/parity-fixture.ts
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { buildDemo } from '../src/wasplab/scenarios.js';
import { toRiskRow } from '../src/brain/risk.js';

const rows = buildDemo(7, Date.UTC(2026, 10, 12)).sort((a, b) => a.at - b.at).map(toRiskRow);
const py = `
import json, sys
sys.path.insert(0, 'brain')
from colony.brain import Brain
rows = json.load(sys.stdin)
out = Brain().score(rows)
print(json.dumps(out))
`;
const r = spawnSync('python3', ['-W', 'ignore', '-c', py], { input: JSON.stringify(rows), encoding: 'utf8', cwd: process.cwd(), maxBuffer: 1 << 26 });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const expected = JSON.parse(r.stdout);
writeFileSync('tests/fixtures/risk_parity.json', JSON.stringify({ rows, expected }));
console.log(`wrote ${rows.length} rows, ${expected.filter((e: any) => e.flag_model).length} flagged by the Python model`);
