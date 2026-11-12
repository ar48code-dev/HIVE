/** Independent check: score HIVE's OWN Wasp Lab streams (a different generator from the one the brain was trained on). Needs the brain running: BRAIN_URL=http://127.0.0.1:8787 */
import { ATTACKS, INJECTION_ATTACKS, INJECTION_BENIGN, buildRun } from '../src/wasplab/scenarios.js';
import { DAY } from '../src/risk/engine.js';
import { brainCheck, brainScore, toBrainTxn } from '../src/brain/client.js';

const seeds = Array.from({ length: 20 }, (_, i) => 100 + i);
let benignAll = 0, fpAll = 0, hardAll = 0, hardFp = 0;
for (const attack of Object.keys(ATTACKS)) {
  let caught = 0, fp = 0, benign = 0;
  for (const s of seeds) {
    const { txns, attackIds } = buildRun(attack, s);
    const sc = await brainScore(txns.map(toBrainTxn)); if (!sc) throw new Error('brain not reachable');
    let hit = false; const warm = (txns[0]?.at ?? 0) + 30 * DAY; // same metric as HIVE's Wasp Lab: first 30 days are warm-up
    txns.forEach((t, i) => { if (t.at < warm) return; const f = sc[i]!.flag_model; if (attackIds.has(t.id)) hit ||= f; else if (t.label?.benignHard) { hardAll++; if (f) hardFp++; } else { benign++; if (f) fp++; } });
    caught += hit ? 1 : 0;
  }
  benignAll += benign; fpAll += fp;
  console.log(`${attack.padEnd(22)} model caught ${caught}/${seeds.length} incidents | false alarms ${(1000 * fp / benign).toFixed(1)} per 1000 benign`);
}
console.log(`ALL attacks: false alarms ${(1000 * fpAll / benignAll).toFixed(1)} per 1000 benign | hard negatives flagged ${(100 * hardFp / hardAll).toFixed(1)}%`);
const text = (x: unknown) => (typeof x === 'string' ? x : String((x as { note?: string; text?: string }).note ?? (x as { text?: string }).text ?? ''));
const inj = await Promise.all((INJECTION_ATTACKS as unknown[]).map((x) => brainCheck(text(x))));
const ben = await Promise.all((INJECTION_BENIGN as unknown[]).map((x) => brainCheck(text(x))));
console.log(`HIVE's own injection strings: brain flagged ${inj.filter((r) => r?.injection).length}/${inj.length} attacks and ${ben.filter((r) => r?.injection).length}/${ben.length} benign notes`);
