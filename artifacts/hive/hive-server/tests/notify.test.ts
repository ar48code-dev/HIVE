import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoredAlert } from '../src/repo.js';
import type { OutgoingEmail } from '../src/email.js';
import { createGmailEmailSender, encodeGmailMessage } from '../src/email.js';

const alert = (id: number, severity: 'low' | 'medium' | 'high'): StoredAlert => ({ id, txnId: 't' + id, at: 1_700_000_000_000, score: 80, severity, status: 'open', createdAt: 1,
  signals: [{ rule: 'card_testing', weight: 50, detail: 'x', evidenceIds: ['t1'] } as never], nextStep: 'Review the 3 small charges' });

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const k of ['HIVE_ALERT_EMAIL_TO', 'HIVE_ALERT_MIN_SEVERITY']) delete process.env[k];
  Object.assign(process.env, env);
  return import('../src/notify.js');
}

describe('Gmail alert notifications', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends through the Gmail API using only the send endpoint', async () => {
    const proxy = vi.fn(async () => ({ ok: true }) as Response);
    const send = createGmailEmailSender(proxy as never);
    expect(await send({ to: 'alerts@example.com', subject: 'HIVE test', text: 'Hello' })).toBe(true);
    expect(proxy).toHaveBeenCalledWith('google-mail', '/gmail/v1/users/me/messages/send', expect.objectContaining({ method: 'POST' }));
    const payload = JSON.parse(String((proxy.mock.calls[0] as unknown as [string, string, { body: string }])[2].body));
    const raw = Buffer.from(payload.raw, 'base64url').toString('utf8');
    expect(raw).toContain('To: alerts@example.com');
    expect(raw).toContain('Subject: HIVE test');
    expect(raw).toContain('Content-Transfer-Encoding: base64\r\n');
    expect(Buffer.from(raw.split('\r\n\r\n')[1] ?? '', 'base64').toString('utf8')).toBe('Hello');
  });

  it('rejects invalid recipients and removes subject header injection', () => {
    expect(encodeGmailMessage({ to: 'not-an-email', subject: 'x', text: 'body' })).toBeNull();
    const raw = Buffer.from(encodeGmailMessage({ to: 'a@example.com', subject: 'Hello\r\nBcc: bad@example.com', text: 'body' })!, 'base64url').toString();
    expect(raw).toContain('Subject: Hello Bcc: bad@example.com');
    expect(raw).not.toContain('\r\nBcc: bad@example.com');
  });

  it('sends an explicit test email without transaction or customer data', async () => {
    const { sendTestEmail } = await load({ HIVE_ALERT_EMAIL_TO: 'alerts@example.com' });
    const send = vi.fn(async (_email: OutgoingEmail) => true);
    expect(await sendTestEmail(send)).toBe(true);
    expect(send).toHaveBeenCalledWith({
      to: 'alerts@example.com',
      subject: 'HIVE email delivery test',
      text: 'This is a HIVE test email. No payment or customer data is included.',
    });
  });

  it('does nothing without a recipient', async () => {
    const { notifyAlert } = await load({});
    const send = vi.fn();
    expect(await notifyAlert(alert(1, 'high'), send as never)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends readable email once, then again only if severity rises', async () => {
    const { notifyAlert } = await load({ HIVE_ALERT_EMAIL_TO: 'alerts@example.com' });
    const send = vi.fn(async (_email: OutgoingEmail) => true);
    expect(await notifyAlert(alert(7, 'medium'), send as never)).toBe(true);
    const message = send.mock.calls[0]?.[0] as unknown as OutgoingEmail;
    expect(message.subject).toBe('HIVE MEDIUM: alert #7');
    expect(message.text).toContain('MEDIUM alert #7');
    expect(message.to).toBe('alerts@example.com');
    expect(await notifyAlert(alert(7, 'medium'), send as never)).toBe(false); // same severity: no repeat
    expect(await notifyAlert(alert(7, 'high'), send as never)).toBe(true);   // escalated
    expect((send.mock.calls[1]?.[0] as unknown as OutgoingEmail).text).toContain('ALERT ESCALATED');
  });

  it('respects the minimum severity and survives a failing endpoint', async () => {
    const { notifyAlert } = await load({ HIVE_ALERT_EMAIL_TO: 'alerts@example.com', HIVE_ALERT_MIN_SEVERITY: 'high' });
    const send = vi.fn(async (_email: OutgoingEmail) => { throw new Error('down'); });
    expect(await notifyAlert(alert(2, 'medium'), send as never)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(await notifyAlert(alert(3, 'high'), send as never)).toBe(false); // tried, failed, no throw
    expect(send).toHaveBeenCalledTimes(1);
  });
});

