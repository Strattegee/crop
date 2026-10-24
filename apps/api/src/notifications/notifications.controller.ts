import { BadRequestException, Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { queueNotification } from './notify.js';
import { EMAIL_SENDER, SMS_SENDER, type EmailSender, type SmsSender } from './senders.js';

/** Message log and test sends (spec NOT-1, NOT-4). */
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(APP_POOL) private readonly pool: Pool,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Query('limit') limitParam?: string) {
    const limit = Math.min(Math.max(Number(limitParam) || 100, 1), 500);
    return withTenant(this.pool, t.tenantId, async db => {
      const rows = (await db.query(
        `select n.id, n.channel, n.to_address as "to", n.template, n.subject, n.body, n.status, n.attempts,
                n.last_error as "error", n.created_at as "createdAt", n.sent_at as "sentAt",
                w.first_name || ' ' || w.last_name as "workerName", n.worker_id as "workerId"
           from notifications n left join workers w on w.id = n.worker_id
          order by n.created_at desc limit $1`, [limit],
      )).rows;
      const usage = (await db.query<{ used: number; cap: number }>(
        `select (select count(*)::int from notifications where channel = 'sms' and status <> 'skipped'
                   and created_at >= date_trunc('month', now() at time zone 'Australia/Melbourne') at time zone 'Australia/Melbourne') as used,
                coalesce((select sms_monthly_cap from tenant_settings where tenant_id = $1), 2000) as cap`, [t.tenantId],
      )).rows[0];
      return { messages: rows, smsThisMonth: usage.used, smsMonthlyCap: usage.cap, emailReady: this.email.configured, smsReady: this.sms.configured };
    });
  }

  /** Sends a test message: email to the signed-in person, or SMS to the number given. */
  @Roles('owner', 'admin')
  @Post('test')
  test(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const channel = oneOf(body, 'channel', ['email', 'sms'] as const, { required: true })!;
    const to = channel === 'email' ? auth.email : text(body, 'to', { required: true, max: 20 })!;
    if (channel === 'sms' && !/^(\+?61|0)4/.test(to.replace(/[\s()-]/g, ''))) throw new BadRequestException('Enter an Australian mobile number, e.g. 0412 345 678');
    return withTenant(this.pool, t.tenantId, db => queueNotification(db, t.tenantId, {
      channel, to, template: 'test', createdBy: auth.userId,
      subject: channel === 'email' ? 'CROP test email' : undefined,
      body: channel === 'email'
        ? `Hello from CROP.\n\nThis is a test email for ${t.tenantName}. If you can read this, email sending is working.`
        : `CROP test message for ${t.tenantName}. If you got this, SMS sending is working.`,
    }));
  }
}
