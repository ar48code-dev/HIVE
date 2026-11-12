/**
 * Deterministic question router. It decides which facts Queen needs and how the no-key template should answer.
 * It never decides anything about money: it only classifies the wording of a question.
 */
export type Intent =
  | 'alert_detail' | 'forecast' | 'action_request' | 'alerts'
  | 'customers' | 'refunds' | 'fees' | 'report_daily' | 'report_weekly' | 'overview';

export interface Classified { intent: Intent; alertNo?: number; secondary: Intent[] }

const FORECAST = /\b(forecast|predict|projection|next (month|quarter|year)|will i|going to earn)\b/i;
const ACTION = /(ignore (all |any |the |your )?(previous|prior|above)|system prompt|you are now|\b(refund|pay|send|transfer|cancel|freeze|block|ban)\b.{0,30}\b(everything|everyone|all of|all customers|now)\b)/i;
const ALERT_NO = /\balert\s*(?:#|no\.?|number)?\s*(\d{1,6})\b/i;

const RULES: Array<[Intent, RegExp]> = [
  ['alerts', /\b(suspicious|fraud\w*|alerts?|risk\w*|anomal\w*|unusual|attack\w*|wasps?|danger\w*|problems?|wrong|abuse|scam\w*|card[- ]testing)\b/i],
  ['customers', /\b(customers?|buyers?|clients?|who (pays|paid|bought)|biggest|largest|top|repeat|loyal|concentration)\b/i],
  ['refunds', /\b(refund\w*|chargebacks?|disputes?|returns?)\b/i],
  ['fees', /\b(fees?|charged me|cost|net|kept|keep|take[- ]home|paypal take|margin)\b/i],
  ['report_daily', /\b(daily|today|yesterday|24 hours?)\b/i],
  ['report_weekly', /\b(weekly|week|this week|last week|7 days)\b/i],
];

export function classifyQuestion(q: string): Classified {
  const m = ALERT_NO.exec(q);
  if (m) return { intent: 'alert_detail', alertNo: Number(m[1]), secondary: [] };
  if (FORECAST.test(q)) return { intent: 'forecast', secondary: [] };
  if (ACTION.test(q)) return { intent: 'action_request', secondary: [] };
  const hits = RULES.filter(([, re]) => re.test(q)).map(([i]) => i);
  if (!hits.length) return { intent: 'overview', secondary: [] };
  return { intent: hits[0]!, secondary: hits.slice(1) };
}

import type { BrainRoute } from '../brain/client.js';

const REROUTABLE = new Set<Intent>(['alerts', 'customers', 'refunds', 'fees', 'report_daily', 'report_weekly']);

/**
 * Lets the learned router help, never hurt: it can ADD a refusal (money-moving / forecast wording the keyword router missed),
 * or pick a topic when the keyword router found none. It never overrides forecast, action or alert-number questions.
 */
export function brainOverride(base: Classified, b: BrainRoute | null): Classified | undefined {
  if (!b || base.intent === 'alert_detail' || base.intent === 'forecast' || base.intent === 'action_request') return undefined;
  if (b.refuse) return { intent: b.intent === 'forecast' ? 'forecast' : 'action_request', secondary: [] };
  if (base.intent === 'overview' && b.confidence >= 0.6 && REROUTABLE.has(b.intent as Intent)) return { intent: b.intent as Intent, secondary: [] };
  return undefined;
}

export const SUGGESTED_QUESTIONS = [
  'Is anything suspicious right now?',
  'Who is my biggest customer and how concentrated is my revenue?',
  'What is my refund rate and who is getting refunds?',
  'How much did PayPal fees cost me, and what did I keep?',
  'Write my weekly report',
  'Give me my daily summary',
];
