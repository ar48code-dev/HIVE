import { config } from './config.js';
import type { StoredAlert } from './repo.js';
import { sendGmailEmail, type EmailSender } from './email.js';

// Sends plain-language alerts through Gmail. Failures never block payment or alert handling.
const RANK = { low: 0, medium: 1, high: 2 } as const;
const sent = new Map<number, number>(); // alertId -> highest severity rank already sent

async function attempt(email: Parameters<EmailSender>[0], send: EmailSender): Promise<boolean> {
  try { return await send(email); } catch { return false; }
}

export function alertMessage(a: StoredAlert): string {
  const rules = a.signals.map((s) => s.rule.replace(/_/g, ' ')).slice(0, 3).join(', ');
  return `HIVE ${a.severity.toUpperCase()} alert #${a.id} (score ${a.score}): ${rules}. Next step: ${a.nextStep}`;
}

/** Explicit test: sends a real email, but includes no payment or customer information. */
export function sendTestEmail(send: EmailSender = sendGmailEmail): Promise<boolean> {
  if (!config.HIVE_ALERT_EMAIL_TO) return Promise.resolve(false);
  return attempt({
    to: config.HIVE_ALERT_EMAIL_TO,
    subject: 'HIVE email delivery test',
    text: 'This is a HIVE test email. No payment or customer data is included.',
  }, send);
}

export async function notifyAlert(a: StoredAlert, send: EmailSender = sendGmailEmail): Promise<boolean> {
  if (!config.HIVE_ALERT_EMAIL_TO) return false;
  const rank = RANK[a.severity];
  if (rank < RANK[config.HIVE_ALERT_MIN_SEVERITY]) return false;
  const prev = sent.get(a.id);
  if (prev !== undefined && prev >= rank) return false; // same or lower severity already announced
  const event = prev === undefined ? 'NEW ALERT' : 'ALERT ESCALATED';
  const link = config.PUBLIC_URL ? `\nOpen HIVE: ${config.PUBLIC_URL.replace(/\/$/, '')}/#alert-${a.id}` : '';
  const delivered = await attempt({
    to: config.HIVE_ALERT_EMAIL_TO,
    subject: `HIVE ${a.severity.toUpperCase()}: alert #${a.id}`,
    text: `${event}\n${alertMessage(a)}\nRules: ${a.signals.map((s) => s.rule).slice(0, 3).join(', ')}\n${link}`,
  }, send);
  if (delivered) sent.set(a.id, rank);
  return delivered;
}
