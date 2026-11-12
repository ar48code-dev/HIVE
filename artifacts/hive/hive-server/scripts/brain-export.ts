/** Export HIVE's Wasp Lab streams for training/evaluating the brain's risk model. Rows: [t_sec, customer, dollars, kind, isAttack, isHardNegative, afterWarmup, hiveRulesAlerted] */
import { writeFileSync } from 'node:fs';
import { ATTACKS, buildRun } from '../src/wasplab/scenarios.js';
import { runScenario } from '../src/wasplab/evaluate.js';
import { DAY } from '../src/risk/engine.js';

const kind = (k: string) => (k === 'payment' ? 'pay' : k === 'refund' ? 'refund' : 'fail');
const dump = (attack: string, seed: number, withRules: boolean) => {
  const { txns, attackIds } = buildRun(attack, seed);
  const warm = (txns[0]?.at ?? 0) + 30 * DAY;
  const alerted = withRules ? new Set(runScenario(attack, seed).alerts.map((a) => a.txnId)) : new Set<string>();
  return { attack, seed, rows: txns.map((t) => [t.at / 1000, t.customerKey, t.amountCents / 100, kind(t.kind), attackIds.has(t.id) ? 1 : 0, t.label?.benignHard ? 1 : 0, t.at >= warm ? 1 : 0, alerted.has(t.id) ? 1 : 0]) };
};
const train: unknown[] = [], test: unknown[] = [];
for (const a of Object.keys(ATTACKS)) {
  for (let s = 1; s <= 50; s++) train.push(dump(a, s, false));
  for (let s = 100; s < 120; s++) test.push(dump(a, s, true));
}
writeFileSync('/tmp/hive_streams.json', JSON.stringify({ train, test }));
console.log('streams', train.length, test.length);
