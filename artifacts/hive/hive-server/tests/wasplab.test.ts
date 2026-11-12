import { describe, expect, it } from 'vitest';
import { runAll, runScenario } from '../src/wasplab/evaluate.js';
import { ATTACKS } from '../src/wasplab/scenarios.js';

describe('Wasp Lab', () => {
  it('is reproducible for a given seed', () => {
    const a = runScenario('card_testing', 7);
    const b = runScenario('card_testing', 7);
    expect(JSON.stringify(a.alerts)).toBe(JSON.stringify(b.alerts));
  });

  it('every scenario produces labelled attack transactions and a result', () => {
    for (const name of Object.keys(ATTACKS)) {
      const r = runScenario(name, 1);
      expect(r.benignEvaluated).toBeGreaterThan(100);
      expect(typeof r.caught).toBe('boolean');
    }
  });

  it('report has the fields the scorecard UI and README depend on', () => {
    const rep = runAll(3, 500);
    expect(rep.scenarios).toHaveLength(Object.keys(ATTACKS).length);
    expect(rep.overallRecall).toBeGreaterThanOrEqual(0);
    expect(rep.injection.attacksTotal).toBeGreaterThan(0);
    expect(Array.isArray(rep.misses)).toBe(true);
  });
});
