import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, email, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { queueNotification } from '../notifications/notify.js';
import { actorOf } from '../roster/publishing.js';
import { rosterChangeRefusal } from '../roster/offers-data.js';
import { shiftById } from '../roster/roster.controller.js';
import { wordsFor } from '../terms/words.js';
import { RESEND_MINUTES, outsideAgencyEmail, outsideProblem, outsideRequirements, type RuleRow } from './outside.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = `id, name, email, phone, notes, active, created_at as "createdAt"`;
type Agency = { id: string; name: string; email: string; phone: string | null; notes: string | null; active: boolean; createdAt: Date };

/** Every credential rule that applies to a shift: its role's rules (`forDuty` null), its duties' and its booked equipment's operators. */
async function shiftRules(db: PoolClient, shiftId: string): Promise<RuleRow[]> {
  return (await db.query<RuleRow>(
    `with s as (select * from shifts where id = $1)
     select ct.name, x.sev as severity, x.duty as "forDuty" from (
       select r.credential_type_id, r.severity::text as sev, null::text as duty
         from credential_requirements r, s where r.scope = 'all_workers' or r.role = s.role
       union all
       select dr.credential_type_id, dr.severity::text, d.name
         from shift_duty_links l join shift_duties d on d.id = l.duty_id join shift_duty_requirements dr on dr.duty_id = d.id
        where l.shift_id = $1
       union all
       select et.operator_credential_type_id, 'hard', et.name || ' operator'
         from shift_assignments a join equipment e on e.id = a.equipment_id join equipment_types et on et.id = e.equipment_type_id
        where a.shift_id = $1 and a.resource_kind = 'equipment' and a.status = 'confirmed' and et.operator_credential_type_id is not null
     ) x join credential_types ct on ct.id = x.credential_type_id and ct.active`, [shiftId])).rows;
}

async function outsideState(db: PoolClient, shiftId: string, now = new Date()) {
  const shift = await shiftById(db, shiftId);
  const agencies = (await db.query<Agency>(`select ${COLS} from outside_agencies where active order by lower(name)`)).rows;
  const sent = (await db.query<{ id: string; agencyId: string; agencyName: string; toAddress: string; note: string | null; sentByName: string | null; sentAt: Date; delivery: string | null }>(
    `select e.id, e.outside_agency_id as "agencyId", e.agency_name as "agencyName", e.to_address as "toAddress", e.note, e.sent_by_name as "sentByName",
            e.sent_at as "sentAt", n.status as delivery
       from outside_agency_emails e left join notifications n on n.id = e.notification_id
      where e.shift_id = $1 order by e.sent_at desc`, [shiftId])).rows;
  const w = await wordsFor(db);
  const problem = outsideProblem({ status: shift.status, equipmentOnly: shift.equipmentOnly, startsAt: new Date(shift.startsAt) }, agencies.length, now, w);
  return {
    shiftId,
    agencies: agencies.map(a => ({ id: a.id, name: a.name, email: a.email, lastSentAt: sent.find(s => s.agencyId === a.id)?.sentAt ?? null })),
    requirements: outsideRequirements(await shiftRules(db, shiftId)),
    sent,
    canSend: problem === null,
    problem,
  };
}

/**
 * Agencies not on CROP (backlog item 8, migration 0059; David's answer 4, 29 Oct). The business's list of outside
 * agencies (owners and admins keep it; switched off, never deleted), and emailing an open shift to some of them
 * with its standard and special requirements, each marked must have / ideal / optional. They reply outside CROP.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class OutsideAgenciesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** The business's outside agencies, switched-on ones first. */
  @Roles(...OFFICE_ROLES)
  @Get('outside-agencies')
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query<Agency & { emailsSent: number; lastSentAt: Date | null }>(
      `select ${COLS.split(', ').map(c => `a.${c}`).join(', ')},
              (select count(*)::int from outside_agency_emails e where e.outside_agency_id = a.id) as "emailsSent",
              (select max(e.sent_at) from outside_agency_emails e where e.outside_agency_id = a.id) as "lastSentAt"
         from outside_agencies a order by a.active desc, lower(a.name)`)).rows);
  }

  /** Add one (`{ name, email, phone?, notes? }`). */
  @Roles('owner', 'admin')
  @Post('outside-agencies')
  add(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const name = text(body ?? {}, 'name', { required: true, max: 120 })!;
    const to = email(body ?? {}, 'email');
    if (!to) throw new BadRequestException('Email is required');
    const phone = text(body ?? {}, 'phone', { max: 40 });
    const notes = text(body ?? {}, 'notes', { max: 500 });
    return withTenant(this.pool, t.tenantId, async db => {
      if ((await db.query('select 1 from outside_agencies where lower(name) = lower($1)', [name])).rowCount) {
        throw new ConflictException(`${name} is already on your list`);
      }
      return (await db.query<Agency>(
        `insert into outside_agencies(tenant_id, name, email, phone, notes) values ($1,$2,$3,$4,$5) returning ${COLS}`,
        [t.tenantId, name, to, phone, notes])).rows[0];
    }, actorOf(auth));
  }

  /** Change details or switch one off and on (`{ name?, email?, phone?, notes?, active? }`; blank phone or notes clears). */
  @Roles('owner', 'admin')
  @Patch('outside-agencies/:id')
  update(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const b = body ?? {};
    const name = text(b, 'name', { max: 120 });
    const to = email(b, 'email');
    const active = bool(b, 'active');
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    const phone = text(b, 'phone', { max: 40 });
    const notes = text(b, 'notes', { max: 500 });
    return withTenant(this.pool, t.tenantId, async db => {
      const cur = (await db.query<Agency>(`select ${COLS} from outside_agencies where id = $1 for update`, [id])).rows[0];
      if (!cur) throw new NotFoundException('Agency not found');
      if (name && name.toLowerCase() !== cur.name.toLowerCase()
          && (await db.query('select 1 from outside_agencies where lower(name) = lower($1) and id <> $2', [name, id])).rowCount) {
        throw new ConflictException(`${name} is already on your list`);
      }
      return (await db.query<Agency>(
        `update outside_agencies set name = $2, email = $3, phone = $4, notes = $5, active = $6, updated_at = now() where id = $1 returning ${COLS}`,
        [id, name ?? cur.name, to ?? cur.email, has('phone') ? phone : cur.phone, has('notes') ? notes : cur.notes, active ?? cur.active])).rows[0];
    }, actorOf(auth));
  }

  /** For the shift panel: the outside agencies it can be emailed to, what the email will list, and what has been sent. */
  @Roles(...OFFICE_ROLES)
  @Get('shifts/:id/outside-agencies')
  state(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, db => outsideState(db, id));
  }

  /**
   * Email an open shift to outside agencies (`{ agencyIds, note? }`). Each gets its own email listing the standard
   * and special requirements and saying to reply to the person who sent it (their sign-in email). The same agency
   * isn't emailed about the same shift again within 10 minutes. Changes nothing on the shift.
   */
  @Roles(...OFFICE_ROLES)
  @Post('shifts/:id/outside-agencies')
  @HttpCode(200)
  send(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const raw = body?.agencyIds;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20 || raw.some(x => typeof x !== 'string' || !UUID.test(x))) {
      throw new BadRequestException('Choose at least one agency');
    }
    const agencyIds = [...new Set(raw as string[])];
    const note = text(body ?? {}, 'note', { max: 300 });
    const actor = actorOf(auth);
    return withTenant(this.pool, t.tenantId, async db => {
      await db.query('select 1 from shifts where id = $1 for update', [id]);
      const st = await outsideState(db, id);
      if (st.problem) throw new BadRequestException(st.problem);
      // Leads to a change on the shift (the office adds the person), so the after-publishing rule applies, as for offers.
      const refusal = await rosterChangeRefusal(db, id);
      if (refusal) throw new BadRequestException(refusal);
      const chosen = (await db.query<Agency>(`select ${COLS} from outside_agencies where id = any($1::uuid[])`, [agencyIds])).rows;
      if (chosen.length !== agencyIds.length) throw new BadRequestException('Choose agencies from your list');
      const off = chosen.find(a => !a.active);
      if (off) throw new BadRequestException(`${off.name} is switched off`);
      const recent = (await db.query<{ agency_name: string }>(
        `select agency_name from outside_agency_emails where shift_id = $1 and outside_agency_id = any($2::uuid[])
            and sent_at > now() - make_interval(mins => $3) limit 1`, [id, agencyIds, RESEND_MINUTES])).rows[0];
      if (recent) throw new ConflictException(`${recent.agency_name} was emailed about this in the last ${RESEND_MINUTES} minutes`);
      const shift = await shiftById(db, id);
      const w = await wordsFor(db);
      for (const a of chosen.sort((x, y) => x.name.localeCompare(y.name))) {
        const { subject, body: text } = outsideAgencyEmail({
          businessName: t.tenantName, siteName: shift.facilityName, siteTimezone: shift.timezone, areaName: shift.areaName, role: shift.role,
          startsAt: new Date(shift.startsAt), endsAt: new Date(shift.endsAt), breakMinutes: shift.breakMinutes,
          duties: (shift.duties as { name: string }[]).map(d => d.name), genderRequested: shift.genderRequested,
        }, st.requirements, { agencyName: a.name, note, replyName: auth.displayName, replyEmail: auth.email || null }, w);
        const logId = randomUUID();
        const q = await queueNotification(db, t.tenantId, { channel: 'email', to: a.email, template: 'outside_agency_request', subject, body: text,
          dedupeKey: `outside-agency:${logId}`, createdBy: auth.userId });
        await db.query(
          `insert into outside_agency_emails(id, tenant_id, shift_id, outside_agency_id, agency_name, to_address, note, notification_id, sent_by_name)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [logId, t.tenantId, id, a.id, a.name, a.email, note, q.id, actor.name ?? null]);
      }
      return outsideState(db, id);
    }, actor);
  }
}
