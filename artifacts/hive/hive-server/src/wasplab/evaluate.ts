import { DEFAULTS, DAY, evaluate, median, type EngineConfig } from '../risk/engine.js';
import { sanitizeUntrusted } from '../ai/sanitize.js';
import type { Alert } from '../types.js';
import { ATTACKS, EXPECTED_RULE, INJECTION_ATTACKS, INJECTION_BENIGN, buildRun } from './scenarios.js';

export interface RunResult {
  attack: string;
  seed: number;
  caught: boolean;
  /** True when an alert on an attack transaction included the rule this scenario targets. */
  caughtByExpectedRule: boolean;
  /** Milliseconds from the first attack transaction to the first alert on an attack transaction. */
  detectMs: number | null;
  /** Attack transactions that had already happened when the first alert fired (including that one). */
  attackTxnsBeforeAlert: number | null;
  falseAlarmsBenign: number;
  benignEvaluated: number;
  falseAlarmsHardNegative: number;
  hardNegativeEvaluated: number;
  alerts: Alert[];
  falseAlarmRules: string[];
}

export function runScenario(attack: string, seed: number, cfg: EngineConfig = DEFAULTS): RunResult {
  const { txns, attackIds } = buildRun(attack, seed);
  const warmupEnd = (txns[0]?.at ?? 0) + 30 * DAY;
  const attackTxns = txns.filter((t) => attackIds.has(t.id));
  const firstAttackAt = attackTxns[0]?.at ?? 0;
  const alerts: Alert[] = [];
  let firstHit: Alert | null = null;
  let benignEvaluated = 0, hardEvaluated = 0, falseBenign = 0, falseHard = 0;
  const falseAlarmRules: string[] = [];

  for (let i = 0; i < txns.length; i++) {
    const t = txns[i]!;
    if (t.at < warmupEnd) continue;
    const a = evaluate(txns.slice(0, i), t, cfg);
    const isAttack = attackIds.has(t.id);
    const isHard = !!t.label?.benignHard;
    if (isAttack) {
      if (a) { alerts.push(a); firstHit ??= a; }
    } else {
      if (isHard) hardEvaluated++; else benignEvaluated++;
      if (a) { alerts.push(a); isHard ? falseHard++ : falseBenign++; falseAlarmRules.push(...a.signals.map((x) => x.rule)); }
    }
  }

  const hitIdx = firstHit ? attackTxns.findIndex((t) => t.id === firstHit!.txnId) : -1;
  return {
    attack, seed,
    caught: !!firstHit,
    caughtByExpectedRule: alerts.some((a) => attackIds.has(a.txnId) && a.signals.some((x) => x.rule === EXPECTED_RULE[attack])),
    detectMs: firstHit ? firstHit.at - firstAttackAt : null,
    attackTxnsBeforeAlert: hitIdx >= 0 ? hitIdx + 1 : null,
    falseAlarmsBenign: falseBenign, benignEvaluated,
    falseAlarmsHardNegative: falseHard, hardNegativeEvaluated: hardEvaluated,
    alerts,
    falseAlarmRules,
  };
}

export interface ScenarioSummary {
  attack: string;
  runs: number;
  caught: number;
  caughtByExpectedRule: number;
  recall: number;
  medianDetectMs: number | null;
  medianAttackTxnsBeforeAlert: number | null;
}

export interface Report {
  generatedAt: string;
  seeds: number;
  scenarios: ScenarioSummary[];
  overallRecall: number;
  falseAlarmsPer1000Benign: number;
  hardNegativeFalseAlarmRate: number;
  falseAlarmRules: Record<string, number>;
  injection: { attacksFlagged: number; attacksTotal: number; benignFlagged: number; benignTotal: number };
  misses: Array<{ attack: string; seed: number }>;
}

export function runAll(seeds = 20, firstSeed = 100, cfg: EngineConfig = DEFAULTS): Report {
  const results: RunResult[] = [];
  for (const attack of Object.keys(ATTACKS)) {
    for (let s = 0; s < seeds; s++) results.push(runScenario(attack, firstSeed + s, cfg));
  }
  const scenarios: ScenarioSummary[] = Object.keys(ATTACKS).map((attack) => {
    const rs = results.filter((r) => r.attack === attack);
    const hits = rs.filter((r) => r.caught);
    const ms = hits.map((r) => r.detectMs as number);
    const nb = hits.map((r) => r.attackTxnsBeforeAlert as number);
    return {
      attack, runs: rs.length, caught: hits.length,
      caughtByExpectedRule: rs.filter((r) => r.caughtByExpectedRule).length,
      recall: rs.length ? hits.length / rs.length : 0,
      medianDetectMs: hits.length ? median(ms) : null,
      medianAttackTxnsBeforeAlert: hits.length ? median(nb) : null,
    };
  });
  const benignEval = results.reduce((a, r) => a + r.benignEvaluated, 0);
  const benignFalse = results.reduce((a, r) => a + r.falseAlarmsBenign, 0);
  const hardEval = results.reduce((a, r) => a + r.hardNegativeEvaluated, 0);
  const hardFalse = results.reduce((a, r) => a + r.falseAlarmsHardNegative, 0);
  return {
    generatedAt: new Date().toISOString(),
    seeds,
    scenarios,
    overallRecall: results.filter((r) => r.caught).length / results.length,
    falseAlarmsPer1000Benign: benignEval ? (benignFalse / benignEval) * 1000 : 0,
    hardNegativeFalseAlarmRate: hardEval ? hardFalse / hardEval : 0,
    falseAlarmRules: results.flatMap((r) => r.falseAlarmRules).reduce<Record<string, number>>((m, r) => ((m[r] = (m[r] ?? 0) + 1), m), {}),
    injection: {
      attacksFlagged: INJECTION_ATTACKS.filter((s) => sanitizeUntrusted(s).flagged).length,
      attacksTotal: INJECTION_ATTACKS.length,
      benignFlagged: INJECTION_BENIGN.filter((s) => sanitizeUntrusted(s).flagged).length,
      benignTotal: INJECTION_BENIGN.length,
    },
    misses: results.filter((r) => !r.caught).map((r) => ({ attack: r.attack, seed: r.seed })),
  };
}
