import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';
import { APP_POOL } from '../database/database.module.js';
import { PUSH_OFF } from './push.js';
import { EMAIL_SENDER, PUSH_SENDER, SendError, SMS_SENDER, type EmailSender, type PushSender, type SmsSender } from './senders.js';

type Claimed = { id: string; channel: 'email' | 'sms' | 'push'; to_address: string; subject: string | null; body: string; attempts: number };

const RETRY_SECONDS = [60, 300, 900, 3600]; // then give up (5 attempts in total)

/**
 * Background sender: every few seconds, claims queued messages (across agencies, via a
 * database function) and sends them, retrying temporary failures with increasing delays.
 * Turn off with NOTIFY_DISPATCH=off (tests call runOnce directly).
 */
@Injectable()
export class NotificationDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Notifications');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(APP_POOL) private readonly pool: Pool,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NOTIFY_DISPATCH === 'off') return;
    const every = Number(process.env.NOTIFY_POLL_MS ?? 5000);
    this.timer = setInterval(() => void this.runOnce().catch(err => this.log.error(err)), every);
    this.log.log(`sending: email ${this.email.configured ? 'on' : 'not set up'}, SMS ${this.sms.configured ? 'on' : 'not set up'}, push ${this.push.configured ? 'on' : 'off'}`);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Sends what's due now. Returns how many messages it handled. */
  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      await this.pool.query('select app_requeue_stuck_notifications()');
      const batch = (await this.pool.query<Claimed>(
        'select * from app_claim_notifications(20)',
      )).rows;
      for (const n of batch) await this.deliver(n);
      return batch.length;
    } finally {
      this.running = false;
    }
  }

  private async deliver(n: Claimed) {
    const sender = n.channel === 'email' ? this.email : n.channel === 'sms' ? this.sms : this.push;
    if (!sender.configured) {
      return this.finish(n.id, false, null, n.channel === 'push' ? PUSH_OFF : `${n.channel === 'email' ? 'Email' : 'SMS'} sending is not set up yet`, null);
    }
    try {
      const { id } = n.channel === 'email'
        ? await this.email.send({ to: n.to_address, subject: n.subject ?? 'CROP', text: n.body, idempotencyKey: n.id })
        : n.channel === 'sms'
          ? await this.sms.send({ to: n.to_address, body: n.body, reference: n.id })
          : await this.push.send({ to: n.to_address, title: n.subject ?? 'CROP', body: n.body, reference: n.id });
      await this.finish(n.id, true, id, null, null);
    } catch (err) {
      if (err instanceof SendError && err.gone) await this.pool.query('select app_push_device_gone($1)', [n.id]);
      const retryable = err instanceof SendError ? err.retryable : true;
      const retryIn = retryable ? RETRY_SECONDS[n.attempts - 1] ?? null : null;
      await this.finish(n.id, false, null, (err as Error).message, retryIn);
      this.log.warn(`message ${n.id} ${retryIn ? `will retry in ${retryIn}s` : 'failed'}: ${(err as Error).message}`);
    }
  }

  private finish(id: string, ok: boolean, providerId: string | null, error: string | null, retryIn: number | null) {
    return this.pool.query('select app_finish_notification($1, $2, $3, $4, $5)', [id, ok, providerId, error, retryIn]);
  }
}
