import { writeFileSync } from 'node:fs';
import { runAll } from './evaluate.js';

const arg = (name: string, d: number) => {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? Number(m.split('=')[1]) : d;
};

const seeds = arg('seeds', 20);
const report = runAll(seeds, arg('first-seed', 100));
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const dur = (ms: number | null) => (ms === null ? 'n/a' : ms < 90_000 ? `${Math.round(ms / 1000)}s` : ms < 5_400_000 ? `${Math.round(ms / 60000)}m` : `${(ms / 3_600_000).toFixed(1)}h`);

console.log(`\nWASP LAB scorecard (${seeds} seeds per scenario, synthetic data)\n`);
console.log('scenario'.padEnd(22) + 'caught'.padEnd(9) + 'right rule'.padEnd(12) + 'recall'.padEnd(9) + 'median time to detect'.padEnd(24) + 'attack txns before alert');
for (const s of report.scenarios) {
  console.log(
    s.attack.padEnd(22) + `${s.caught}/${s.runs}`.padEnd(9) + `${s.caughtByExpectedRule}/${s.runs}`.padEnd(12) + pct(s.recall).padEnd(9) +
    dur(s.medianDetectMs).padEnd(24) + (s.medianAttackTxnsBeforeAlert ?? 'n/a'),
  );
}
console.log(`\noverall recall:                         ${pct(report.overallRecall)}`);
console.log(`false alarms per 1000 benign txns:      ${report.falseAlarmsPer1000Benign.toFixed(1)}`);
console.log(`false alarm rate on hard negatives:     ${pct(report.hardNegativeFalseAlarmRate)}`);
console.log(`false alarm sources:                    ${Object.entries(report.falseAlarmRules).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
console.log(`prompt-injection strings flagged:       ${report.injection.attacksFlagged}/${report.injection.attacksTotal}`);
console.log(`benign notes wrongly flagged:           ${report.injection.benignFlagged}/${report.injection.benignTotal}`);
if (report.misses.length) {
  console.log(`\nmisses (${report.misses.length}): ` + report.misses.slice(0, 10).map((m) => `${m.attack}@${m.seed}`).join(', '));
}
writeFileSync('wasplab-report.json', JSON.stringify(report, null, 2));
console.log('\nfull report written to wasplab-report.json\n');
