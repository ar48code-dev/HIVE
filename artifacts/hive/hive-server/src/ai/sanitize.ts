/**
 * Transaction fields (notes, descriptions, custom ids, payer names) are attacker-controlled.
 * They are treated as DATA. This module detects instruction-like text and wraps
 * untrusted content so a prompt can quote it without obeying it.
 */
const INJECTION_PATTERNS: Array<[string, RegExp]> = [
  ['override-instructions', /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your)\b[^.\n]{0,40}\b(instructions?|rules?|prompts?|guidelines?)\b/i],
  ['role-hijack', /\b(you are now|from now on you|act as (an? )?(admin|system|developer)|new instructions?)\b/i],
  ['fake-tags', /<\s*\/?\s*(system|assistant|developer|tool|instructions?)\s*>/i],
  ['money-movement', /\b(refund|send|transfer|pay(out)?|approve)\b[^.\n]{0,30}\b(all|everything|every|immediately|now)\b/i],
  ['secret-exfiltration', /\b(reveal|show|print|leak|output)\b[^.\n]{0,30}\b(system prompt|api key|secret|token|password|credentials?)\b/i],
];

export interface Sanitized {
  text: string;
  flagged: boolean;
  matches: string[];
}

export function sanitizeUntrusted(input: string | undefined | null, maxLen = 200): Sanitized {
  const raw = (input ?? '').toString();
  const matches = INJECTION_PATTERNS.filter(([, re]) => re.test(raw)).map(([name]) => name);
  const text = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>`]/g, '')
    .slice(0, maxLen)
    .trim();
  return { text, flagged: matches.length > 0, matches };
}

/** Wrap untrusted text for inclusion in a prompt as quoted data. */
export function asUntrustedData(input: string | undefined | null, extra?: { suspected?: boolean; masked?: string }): string {
  const s = sanitizeUntrusted(input);
  const text = extra?.masked ? sanitizeUntrusted(extra.masked).text : s.text; // PII-masked text from the brain, when available
  return JSON.stringify({ untrusted_text: text, injection_suspected: s.flagged || !!extra?.suspected });
}
