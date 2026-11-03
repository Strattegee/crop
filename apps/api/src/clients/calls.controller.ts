import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { UUID } from '../roster/shift-create.js';
import { CALL_OUTCOMES, callProblem, OUTCOME_WORDS, type CallDirection, type CallOutcome } from './calls.js';

const id = (body: Record<string, unknown>, key: string, label: string) => {
  const v = text(body, key, { max: 40 });
  if (v !== null && !UUID.test(v)) throw new BadRequestException(`Choose ${label}`);
  return v;
};
const qid = (v: string | undefined) => (v && UUID.test(v) ? v : null);

const COLS = `l.id, l.at, l.direction, l.outcome, l.note, l.user_id as "userId", l.user_name as "userName",
  l.worker_id as "workerId", case when w.id is null then null else coalesce(nullif(trim(w.preferred_name), ''), w.first_name) || ' ' || w.last_name end as "workerName",
  l.client_id as "clientId", c.name as "clientName", l.contact_id as "contactId", l.contact_name as "contactName", l.shift_id as "shiftId",
  to_char(l.at at time zone coalesce(f.timezone, ts.timezone, 'Australia/Melbourne'), 'YYYY-MM-DD') as "localDate",
  to_char(l.at at time zone coalesce(f.timezone, ts.timezone, 'Australia/Melbourne'), 'HH24:MI') as "localTime"`;
const FROM = `call_logs l left join workers w on w.id = l.worker_id left join clients c on c.id = l.client_id
  left join shifts s on s.id = l.shift_id left join facilities f on f.id = s.facility_id
  left join lateral (select timezone from tenant_settings limit 1) ts on true`;

type CallRow = { outcome: CallOutcome; direction: CallDirection } & Record<string, unknown>;
const worded = (r: CallRow) => ({ ...r, outcomeWords: OUTCOME_WORDS[r.outcome] });

/**
 * The call log (David, 3 Nov 2026, answer 1; migration 0079): calls the office made to a worker or a client, with the
 * outcome and a short note, counted per officer on the dashboard. Append-only: a mistake is corrected with a new entry.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('calls')
export class CallsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /**
   * `{ workerId?, clientId?, contactId?, contactName?, shiftId?, outcome, note?, direction? }`. A contact fills in its
   * client and name; a shift must exist. The caller is the signed-in office person.
   */
  @Roles(...OFFICE_ROLES)
  @Post()
  log(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const outcome = oneOf(body, 'outcome', CALL_OUTCOMES, { required: true })!;
    const direction = oneOf(body, 'direction', ['out', 'in'] as const) ?? 'out';
    const note = text(body, 'note', { max: 300 });
    const workerId = id(body, 'workerId', 'a person');
    let clientId = id(body, 'clientId', '{a client}');
    const contactId = id(body, 'contactId', 'a contact');
    let contactName = text(body, 'contactName', { max: 120 });
    const shiftId = id(body, 'shiftId', '{a shift}');
    const problem = callProblem({ workerId, clientId, contactId });
    if (problem) throw new BadRequestException(problem);
    const userName = (auth.displayName || auth.email || 'Someone').slice(0, 200);
    return withTenant(this.pool, t.tenantId, async db => {
      if (workerId && !(await db.query(`select 1 from workers where id = $1 and status <> 'agency'`, [workerId])).rowCount) throw new NotFoundException('Person not found');
      if (contactId) {
        const k = (await db.query<{ client_id: string; name: string }>('select client_id, name from client_contacts where id = $1', [contactId])).rows[0];
        if (!k) throw new NotFoundException('Contact not found');
        if (clientId && clientId !== k.client_id) throw new BadRequestException('That contact is with another {client}');
        clientId = k.client_id;
        contactName = contactName ?? k.name;
      }
      if (clientId && !(await db.query('select 1 from clients where id = $1', [clientId])).rowCount) throw new NotFoundException('{Client} not found');
      if (shiftId && !(await db.query('select 1 from shifts where id = $1', [shiftId])).rowCount) throw new NotFoundException('{Shift} not found');
      const newId = (await db.query<{ id: string }>(
        `insert into call_logs(tenant_id, user_id, user_name, direction, worker_id, client_id, contact_id, contact_name, shift_id, outcome, note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [t.tenantId, auth.userId, userName, direction, workerId, clientId, contactId, contactName, shiftId, outcome, note])).rows[0].id;
      return worded((await db.query<CallRow>(`select ${COLS} from ${FROM} where l.id = $1`, [newId])).rows[0]);
    });
  }

  /** Newest first: `workerId`, `clientId`, `shiftId`, `userId` (whose calls), `days` (1–90, default 30), `limit` (1–200, default 50). */
  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Query() q: Record<string, string | undefined>) {
    const days = q.days ? Number(q.days) : 30;
    const limit = q.limit ? Number(q.limit) : 50;
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new BadRequestException('Choose 1 to 90 days');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new BadRequestException('Choose 1 to 200 calls');
    return withTenant(this.pool, t.tenantId, async db => (await db.query<CallRow>(
      `select ${COLS} from ${FROM}
        where l.at > now() - make_interval(days => $1)
          and ($2::uuid is null or l.worker_id = $2) and ($3::uuid is null or l.client_id = $3)
          and ($4::uuid is null or l.shift_id = $4) and ($5::uuid is null or l.user_id = $5)
        order by l.at desc limit $6`,
      [days, qid(q.workerId), qid(q.clientId), qid(q.shiftId), qid(q.userId), limit])).rows.map(worded));
  }
}
