import { ReplitConnectors } from '@replit/connectors-sdk';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

export type EmailSender = (email: OutgoingEmail) => Promise<boolean>;

const connectors = new ReplitConnectors();

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function safeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function encodeGmailMessage(email: OutgoingEmail): string | null {
  const to = safeHeader(email.to);
  const subject = safeHeader(email.subject);
  if (!to || !subject || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return null;
  const body = Buffer.from(email.text, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();
  return base64Url([
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n'));
}

/** Sends mail through the Replit Gmail connector using its send-only OAuth grant. */
export function createGmailEmailSender(proxy: typeof connectors.proxy = connectors.proxy.bind(connectors)) {
  return async (email: OutgoingEmail): Promise<boolean> => {
    const raw = encodeGmailMessage(email);
    if (!raw) return false;
    try {
      const response = await proxy(
        'google-mail',
        '/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw }),
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  };
}

export const sendGmailEmail = createGmailEmailSender();
