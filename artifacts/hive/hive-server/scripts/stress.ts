/**
 * Stress test: the same attack streams scored by HIVE's rules and by the learned model after the SHOP or the ATTACKER changes.
 * Needs no Python and no keys.   pnpm --filter @workspace/hive run stress -- --seeds=10
 *
 * The model's training covers shop prices 0.15x to 10x and attack tempo 0.5x to 5x. Rows marked "outside training range" go beyond that on purpose.
 */
import { writeFileSync } from 'node:fs';
import { ATTACKS, buildRun } from '../src/wasplab/scenarios.js';
import { DAY, evaluate } from '../src/risk/engine.js';
import { applicability, nativeScore } from '../src/brain/risk.js';
import type { Txn } from '../src/types.js';

const TINY = new Set(['card_testing', 'slow_card_testing']); // testers charge about $1 whatever the shop sells
const SLOWABLE = new Set(['card_testing', 'slow_card_testing', 'failed_streak']);

type Fn = (txns: Txn[], attack: string, ids: Set<string>) => Txn[];
const price = (k: number): Fn => (txns, attack, ids) => txns.map((t) => (TINY.has(attack) && ids.has(t.id) ? t : { ...t, amountCents: Math.max(20, Math.round(t.amountCents * k)), feeCents: Math.round(t.feeCents * k) }));
const tempo = (f: number): Fn => (txns, attack, ids) => {
  if (!SLOWABLE.has(attack)) return txns;
  const first = Math.min(...txns.filter((t) => ids.has(t.id)).map((t) => t.at));
  return txns.map((t) => (ids.has(t.id) ? { ...t, at: first + (t.at - first) * f } : t)).sort((a, b) => a.at - b.at);
};
const both = (a: Fn, b: Fn): Fn => (t, x, i) => b(a(t, x, i), x, i);

const SITUATIONS: Array<{ name: string; inRange: boolean; fn: Fn }> = [
  { name: 'same as training (control)', inRange: true, fn: (t) => t },
  { name: 'cheap-goods shop (prices x0.25)', inRange: true, fn: price(0.25) },
  { name: 'luxury shop (prices x6)', inRange: true, fn: price(6) },
  { name: 'slow attacker (6x slower)', inRange: true, fn: tempo(6) },
  { name: 'cheap shop AND slow attacker', inRange: true, fn: both(price(0.25), tempo(6)) },
  { name: 'extreme cheap shop (x0.08)', inRange: false, fn: price(0.08) },
  { name: 'extreme luxury shop (x14)', inRange: false, fn: price(14) },
  { name: 'very slow attacker (12x slower)', inRange: false, fn: tempo(12) },
];

const arg = process.argv.find((a) => a.startsWith('--seeds='));
const seeds = Array.from({ length: arg ? Number(arg.split('=')[1]) : 10 }, (_, i) => 100 + i);
const out: any[] = [];

for (const sit of SITUATIONS) {
  const per: Record<string, { rules: number; model: number }> = {};
  let ben = 0, rFa = 0, mFa = 0, guard = false;
  for (const attack of Object.keys(ATTACKS)) {
    per[attack] = { rules: 0, model: 0 };
    for (const s of seeds) {
      const { txns: raw, attackIds } = buildRun(attack, s);
      const txns = sit.fn(raw, attack, attackIds).sort((a, b) => a.at - b.at);
      const warm = (txns[0]?.at ?? 0) + 30 * DAY;
      guard ||= !applicability(txns).applicable;
      const sc = nativeScore(txns);
      if (!sc) throw new Error('model weights not found (brain/colony/models)');
      let rHit = false, mHit = false;
      txns.forEach((t, i) => {
        if (t.at < warm) return;
        const rules = !!evaluate(txns.slice(0, i), t), model = sc[i]!.flag;
        if (attackIds.has(t.id)) { rHit ||= rules; mHit ||= model; }
        else if (!t.label?.benignHard) { ben++; if (rules) rFa++; if (model) mFa++; }
      });
      per[attack]!.rules += +rHit; per[attack]!.model += +mHit;
    }
  }
  out.push({ situation: sit.name, inTrainingRange: sit.inRange, perAttack: per, falseAlarmsPer1000: { rules: +(1000 * rFa / ben).toFixed(1), model: +(1000 * mFa / ben).toFixed(1) }, modelSwitchedOffByGuard: guard });
  console.log(`\n=== ${sit.name}${sit.inRange ? '' : '   [outside training range]'}`);
  console.log('attack'.padEnd(22) + 'rules'.padEnd(9) + 'model');
  for (const [a, v] of Object.entries(per)) console.log(a.padEnd(22) + `${v.rules}/${seeds.length}`.padEnd(9) + `${v.model}/${seeds.length}`);
  console.log(`false alarms per 1000 benign:  rules ${(1000 * rFa / ben).toFixed(1)}   model ${(1000 * mFa / ben).toFixed(1)}${guard ? '   (the applicability check switches the model OFF for this shop, so these model numbers are never shown to a merchant)' : ''}`);
}
writeFileSync('stress-report.json', JSON.stringify({ seeds: seeds.length, situations: out }, null, 2));
console.log('\nwrote stress-report.json');
