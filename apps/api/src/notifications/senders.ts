/** Email and SMS providers, behind interfaces so they can be swapped by configuration. */

export class SendError extends Error {
  /** `gone`: the phone is no longer registered for push (app removed or notifications turned off for good). */
  constructor(message: string, readonly retryable: boolean, readonly gone = false) {
    super(message);
  }
}

export interface EmailMessage { to: string; subject: string; text: string; idempotencyKey: string }
export interface SmsMessage { to: string; body: string; reference: string }

export interface EmailSender { readonly configured: boolean; send(m: EmailMessage): Promise<{ id: string }> }
export interface SmsSender { readonly configured: boolean; send(m: SmsMessage): Promise<{ id: string }> }
/** `data` travels with the notification to the app: which business and screen to open when it is tapped. */
export interface PushMessage { to: string; title: string; body: string; reference: string; data?: { tenant: string; screen: string | null } }
export interface PushSender { readonly configured: boolean; send(m: PushMessage): Promise<{ id: string }> }

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
export const SMS_SENDER = Symbol('SMS_SENDER');
export const PUSH_SENDER = Symbol('PUSH_SENDER');

const retryableStatus = (status: number) => status === 429 || status >= 500;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Simple, readable HTML version of a plain-text message (links made clickable). */
export function textToHtml(text: string): string {
  const body = escapeHtml(text)
    .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1b2430">${body}</div>`;
}

export class ResendEmail implements EmailSender {
  readonly configured = true;
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(m: EmailMessage) {
    let res: Response;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', 'idempotency-key': m.idempotencyKey },
        body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, html: textToHtml(m.text) }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new SendError(`email provider unreachable: ${(err as Error).message}`, true);
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !body.id) throw new SendError(`email provider said ${res.status}: ${body.message ?? 'unknown error'}`, retryableStatus(res.status));
    return { id: body.id };
  }
}

export class ClickSendSms implements SmsSender {
  readonly configured = true;
  constructor(private readonly username: string, private readonly apiKey: string, private readonly from: string) {}

  async send(m: SmsMessage) {
    let res: Response;
    try {
      res = await fetch('https://rest.clicksend.com/v3/sms/send', {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.username}:${this.apiKey}`).toString('base64')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ messages: [{ source: 'crop', from: this.from, to: m.to, body: m.body, custom_string: m.reference }] }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new SendError(`SMS provider unreachable: ${(err as Error).message}`, true);
    }
    const body = (await res.json().catch(() => ({}))) as {
      response_code?: string; response_msg?: string; data?: { messages?: Array<{ status?: string; message_id?: string }> };
    };
    const msg = body.data?.messages?.[0];
    if (!res.ok || body.response_code !== 'SUCCESS' || msg?.status !== 'SUCCESS' || !msg.message_id) {
      throw new SendError(`SMS provider said ${res.status}: ${msg?.status ?? body.response_msg ?? 'unknown error'}`, retryableStatus(res.status));
    }
    return { id: msg.message_id };
  }
}

/**
 * Expo's push service (sends to Apple and Google for the app). Needs no key unless the Expo project turns on
 * access tokens, in which case EXPO_ACCESS_TOKEN is sent. Delivery receipts aren't read yet.
 */
export class ExpoPush implements PushSender {
  readonly configured = true;
  constructor(private readonly accessToken: string | null) {}

  async send(m: PushMessage) {
    let res: Response;
    try {
      res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          accept: 'application/json', 'content-type': 'application/json',
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify({ to: m.to, title: m.title, body: m.body, sound: 'default', data: { ref: m.reference, ...m.data } }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new SendError(`push service unreachable: ${(err as Error).message}`, true);
    }
    const body = (await res.json().catch(() => ({}))) as {
      data?: { status?: string; id?: string; message?: string; details?: { error?: string } };
      errors?: Array<{ message?: string }>;
    };
    const d = body.data;
    if (res.ok && d?.status === 'ok' && d.id) return { id: d.id };
    if (d?.details?.error === 'DeviceNotRegistered') throw new SendError('This phone no longer receives CROP notifications', false, true);
    throw new SendError(`push service said ${res.status}: ${d?.message ?? body.errors?.[0]?.message ?? 'unknown error'}`, retryableStatus(res.status));
  }
}

class Disabled implements EmailSender, SmsSender, PushSender {
  readonly configured = false;
  async send(): Promise<{ id: string }> {
    throw new SendError('not set up', false);
  }
}

/** For tests and local development. */
export class MemoryEmail implements EmailSender {
  readonly configured = true;
  readonly sent: EmailMessage[] = [];
  failNext: SendError | null = null;
  async send(m: EmailMessage) {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    this.sent.push(m);
    return { id: `email-${this.sent.length}` };
  }
}
export class MemorySms implements SmsSender {
  readonly configured = true;
  readonly sent: SmsMessage[] = [];
  async send(m: SmsMessage) {
    this.sent.push(m);
    return { id: `sms-${this.sent.length}` };
  }
}

export class MemoryPush implements PushSender {
  readonly configured = true;
  readonly sent: PushMessage[] = [];
  /** Tokens that answer "no longer registered". */
  readonly gone = new Set<string>();
  async send(m: PushMessage) {
    if (this.gone.has(m.to)) throw new SendError('This phone no longer receives CROP notifications', false, true);
    this.sent.push(m);
    return { id: `push-${this.sent.length}` };
  }
}

export function emailFromEnv(): EmailSender {
  const { RESEND_API_KEY, NOTIFY_FROM_EMAIL, NOTIFY_PROVIDERS, NODE_ENV } = process.env;
  if (NOTIFY_PROVIDERS === 'memory' && NODE_ENV !== 'production') return new MemoryEmail();
  return RESEND_API_KEY ? new ResendEmail(RESEND_API_KEY, NOTIFY_FROM_EMAIL ?? 'CROP <noreply@cropwms.com>') : new Disabled();
}

export function smsFromEnv(): SmsSender {
  const { CLICKSEND_USERNAME, CLICKSEND_API_KEY, CLICKSEND_FROM, NOTIFY_PROVIDERS, NODE_ENV } = process.env;
  if (NOTIFY_PROVIDERS === 'memory' && NODE_ENV !== 'production') return new MemorySms();
  return CLICKSEND_USERNAME && CLICKSEND_API_KEY && CLICKSEND_FROM ? new ClickSendSms(CLICKSEND_USERNAME, CLICKSEND_API_KEY, CLICKSEND_FROM) : new Disabled();
}

/** Push is off until David switches it on (PUSH_SEND=on) once the Expo project has Apple and Google credentials. */
export function pushFromEnv(): PushSender {
  const { PUSH_SEND, EXPO_ACCESS_TOKEN, NOTIFY_PROVIDERS, NODE_ENV } = process.env;
  if (NOTIFY_PROVIDERS === 'memory' && NODE_ENV !== 'production') return new MemoryPush();
  return PUSH_SEND === 'on' ? new ExpoPush(EXPO_ACCESS_TOKEN || null) : new Disabled();
}
