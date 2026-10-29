import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { date, email, oneOf, text, textList } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { credentialStatus, optionalFor, todayIn } from './compliance.js';
import { loadSettings } from './settings.js';
import { complianceContext, credentialFactsByWorker, rightToWorkByWorker } from './compliance-data.js';
import { beginOnboarding } from './onboarding.controller.js';

const STATUSES = ['active', 'onboarding', 'inactive', 'offboarded'] as const;
const EMPLOYMENT = ['full_time', 'part_time', 'casual', 'bank', 'none', 'left'] as const;
const WORKER_COLUMNS = `w.id, w.first_name as "firstName", w.last_name as "lastName", w.preferred_name as "preferredName",
  w.email, w.phone, w.status, w.roles, w.notes, w.created_at as "createdAt"`;
const CRED_COLUMNS = `c.id, c.credential_type_id as "credentialTypeId", t.name as "typeName", t.category,
  t.verification_method as "verificationMethod", t.verification_url as "verificationUrl",
  c.number, c.issued_by as "issuedBy", to_char(c.issue_date, 'YYYY-MM-DD') as "issueDate", to_char(c.expiry_date, 'YYYY-MM-DD') as "expiryDate",
  c.evidence, c.verification, c.verified_at as "verifiedAt", c.verification_note as "verificationNote",
  c.rejection_reason as "rejectionReason", c.notes, c.updated_at as "updatedAt"`;

type Row = Record<string, unknown>;

@ApiBearerAuth()
@Controller('workers')
export class WorkersController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Workers with their compliance status and today's employment. Filters: search (name, email, phone), status, compliance, role, employment (a type, `none` or `left`; `leftOn` is the last day of someone who has left). */
  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Query() q: Record<string, string | undefined>) {
    const search = q.search?.trim().slice(0, 100) || null;
    const status = q.status && (STATUSES as readonly string[]).includes(q.status) ? q.status : null;
    const employment = q.employment && (EMPLOYMENT as readonly string[]).includes(q.employment) ? q.employment : null;
    return withTenant(this.pool, t.tenantId, async db => {
      // Employment today in the business's time zone (live terms only; corrected entries are ignored).
      const today = todayIn((await loadSettings(db, t.tenantId)).timezone);
      const workers = (await db.query<Row & { id: string; roles: string[] }>(
        `select ${WORKER_COLUMNS}, et.employment_type as "employmentType", et.contracted_hours::float8 as "contractedHours",
                to_char(lt.ends_on, 'YYYY-MM-DD') as "leftOn"
           from workers w
           left join lateral (select case when l.end_reason is not null and l.ends_on < $5 then l.ends_on end as ends_on
                                from (select ends_on, end_reason from employment_terms e where e.worker_id = w.id and e.withdrawn_at is null
                                       order by e.starts_on desc limit 1) l) lt on true
           left join lateral (select employment_type, contracted_hours from employment_terms e
                               where e.worker_id = w.id and e.withdrawn_at is null and e.starts_on <= $5 and (e.ends_on is null or e.ends_on >= $5)
                               order by e.starts_on desc limit 1) et on true
          where ($1::text is null or (w.first_name || ' ' || w.last_name || ' ' || coalesce(w.preferred_name,'') || ' ' || coalesce(w.email,'') || ' ' || coalesce(w.phone,'')) ilike '%' || $1 || '%')
            and ($2::worker_status is null or w.status = $2)
            and ($3::text is null or $3 = any(w.roles))
            and ($4::text is null or ($4 = 'none' and et.employment_type is null and lt.ends_on is null) or ($4 = 'left' and lt.ends_on is not null)
                 or et.employment_type::text = $4)
          order by w.last_name, w.first_name limit 500`,
        [search, status, q.role?.trim() || null, employment, today],
      )).rows;
      const ctx = await complianceContext(db, t.tenantId);
      const facts = await credentialFactsByWorker(db, workers.map(w => w.id));
      const rtw = await rightToWorkByWorker(db, workers.map(w => w.id));
      const withCompliance = workers.map(w => {
        const c = ctx.evaluate(w.roles, facts.get(w.id) ?? [], rtw.get(w.id) ?? null);
        return { ...w, compliance: c.status, issueCount: c.issues.filter(i => i.severity === 'hard' && i.problem !== 'expiring').length };
      });
      return q.compliance ? withCompliance.filter(w => w.compliance === q.compliance) : withCompliance;
    });
  }

  /** Adds a worker. `onboardingChecklistId` starts onboarding them at once and keeps them off the roster until it's finished. */
  @Roles(...OFFICE_ROLES)
  @Post()
  create(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const checklistId = text(body, 'onboardingChecklistId', { max: 40 });
    if (checklistId && !/^[0-9a-f-]{36}$/i.test(checklistId)) throw new BadRequestException('Choose a checklist');
    const values = [
      t.tenantId,
      text(body, 'firstName', { required: true, max: 100 }),
      text(body, 'lastName', { required: true, max: 100 }),
      text(body, 'preferredName', { max: 100 }),
      email(body, 'email'),
      text(body, 'phone', { max: 30 }),
      textList(body, 'roles') ?? [],
      text(body, 'notes', { max: 2000 }),
    ];
    return withTenant(this.pool, t.tenantId, async db => {
      try {
        const row = (await db.query<{ id: string }>(
          `insert into workers as w (tenant_id, first_name, last_name, preferred_name, email, phone, roles, notes)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${WORKER_COLUMNS}`, values,
        )).rows[0];
        if (!checklistId) return row;
        await beginOnboarding(db, t.tenantId, auth, row.id, checklistId, true);
        return (await db.query(`select ${WORKER_COLUMNS} from workers w where w.id = $1`, [row.id])).rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new BadRequestException('A worker with that email already exists');
        throw err;
      }
    });
  }

  /** A worker with their credentials, compliance status and issues, and the optional requirements that apply to them (listed, never checked). */
  @Roles(...OFFICE_ROLES)
  @Get(':id')
  get(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const worker = (await db.query<Row & { roles: string[] }>(`select ${WORKER_COLUMNS} from workers w where w.id = $1`, [id])).rows[0];
      if (!worker) throw new NotFoundException('worker not found');
      const ctx = await complianceContext(db, t.tenantId);
      const credentials = (await db.query<Row & { expiryDate: string | null }>(
        `select ${CRED_COLUMNS} from worker_credentials c join credential_types t on t.id = c.credential_type_id
          where c.worker_id = $1 order by t.name, c.expiry_date desc nulls first`, [id],
      )).rows.map(c => ({ ...c, status: credentialStatus(c.expiryDate, ctx.today, ctx.settings.expiringWindowDays) }));
      const docs = (await db.query<{ credentialId: string }>(
        `select d.id, d.worker_credential_id as "credentialId", d.filename, d.content_type as "contentType",
                d.size_bytes as "sizeBytes", d.uploaded_at as "uploadedAt"
           from credential_documents d join worker_credentials c on c.id = d.worker_credential_id
          where c.worker_id = $1 and d.removed_at is null order by d.uploaded_at`, [id],
      )).rows;
      for (const c of credentials as unknown as Array<{ id: string; documents?: unknown[] }>) c.documents = docs.filter(d => d.credentialId === c.id);
      const facts = (await credentialFactsByWorker(db, [id])).get(id) ?? [];
      const compliance = ctx.evaluate(worker.roles, facts, (await rightToWorkByWorker(db, [id])).get(id) ?? null);
      const optional = optionalFor(worker.roles, ctx.rules, facts, ctx.today);
      return { ...worker, credentials, compliance: compliance.status, issues: compliance.issues, optional, today: ctx.today };
    });
  }

  @Roles(...OFFICE_ROLES)
  @Patch(':id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return withTenant(this.pool, t.tenantId, async db => {
      try {
        const row = (await db.query(
          `update workers as w set
             first_name = coalesce($2, first_name), last_name = coalesce($3, last_name),
             preferred_name = case when $4::boolean then $5 else preferred_name end,
             email = case when $6::boolean then $7 else email end,
             phone = case when $8::boolean then $9 else phone end,
             roles = coalesce($10, roles), status = coalesce($11::worker_status, status),
             notes = case when $12::boolean then $13 else notes end,
             updated_at = now()
           where id = $1 returning ${WORKER_COLUMNS}`,
          [id, text(body, 'firstName', { max: 100 }), text(body, 'lastName', { max: 100 }),
            body && 'preferredName' in body, text(body, 'preferredName', { max: 100 }),
            body && 'email' in body, email(body, 'email'),
            body && 'phone' in body, text(body, 'phone', { max: 30 }),
            textList(body, 'roles'), oneOf(body, 'status', STATUSES),
            body && 'notes' in body, text(body, 'notes', { max: 2000 })],
        )).rows[0];
        if (!row) throw new NotFoundException('worker not found');
        return row;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new BadRequestException('A worker with that email already exists');
        throw err;
      }
    });
  }

  // ---- Credentials ----

  @Roles(...OFFICE_ROLES)
  @Post(':id/credentials')
  addCredential(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) workerId: string, @Body() body: Record<string, unknown>) {
    const typeId = text(body, 'credentialTypeId', { required: true, max: 40 })!;
    if (!/^[0-9a-f-]{36}$/i.test(typeId)) throw new BadRequestException('Choose a credential');
    const fields = credentialFields(body);
    return withTenant(this.pool, t.tenantId, async db => {
      const worker = await db.query('select 1 from workers where id = $1', [workerId]);
      if (!worker.rowCount) throw new NotFoundException('worker not found');
      const type = (await db.query<{ has_expiry: boolean; has_number: boolean }>('select has_expiry, has_number from credential_types where id = $1 and active', [typeId])).rows[0];
      if (!type) throw new NotFoundException('credential type not found');
      if (type.has_expiry && !fields.expiryDate) throw new BadRequestException('Expiry date is required for this credential');
      if (type.has_number && !fields.number) throw new BadRequestException('Number is required for this credential');
      const row = (await db.query<{ id: string }>(
        `insert into worker_credentials(tenant_id, worker_id, credential_type_id, number, issue_date, expiry_date, notes, issued_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [t.tenantId, workerId, typeId, fields.number, fields.issueDate, fields.expiryDate, fields.notes, fields.issuedBy],
      )).rows[0];
      await event(db, t.tenantId, row.id, auth.userId, 'created', fields);
      return getCredential(db, workerId, row.id);
    });
  }

  /** Changing the number or dates of a verified credential needs it verified again. */
  @Roles(...OFFICE_ROLES)
  @Patch(':id/credentials/:credentialId')
  updateCredential(
    @Tenant() t: Membership, @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) workerId: string, @Param('credentialId', ParseUUIDPipe) credentialId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const fields = credentialFields(body);
    const has = (k: string) => Boolean(body && k in body);
    return withTenant(this.pool, t.tenantId, async db => {
      const before = (await db.query<{
        number: string | null; issuedBy: string | null; issue: string | null; expiry: string | null; verification: string; notes: string | null;
        hasNumber: boolean; hasExpiry: boolean;
      }>(
        `select c.number, c.issued_by as "issuedBy", to_char(c.issue_date,'YYYY-MM-DD') as issue, to_char(c.expiry_date,'YYYY-MM-DD') as expiry,
                c.verification, c.notes, t.has_number as "hasNumber", t.has_expiry as "hasExpiry"
           from worker_credentials c join credential_types t on t.id = c.credential_type_id
          where c.id = $1 and c.worker_id = $2 for update of c`, [credentialId, workerId],
      )).rows[0];
      if (!before) throw new NotFoundException('credential not found');
      const next = {
        number: has('number') ? fields.number : before.number,
        issuedBy: has('issuedBy') ? fields.issuedBy : before.issuedBy,
        issueDate: has('issueDate') ? fields.issueDate : before.issue,
        expiryDate: has('expiryDate') ? fields.expiryDate : before.expiry,
      };
      if (next.issueDate && next.expiryDate && next.expiryDate < next.issueDate) throw new BadRequestException('Expiry date must be on or after the issue date');
      // The same rules as adding: a credential type that has a number or an expiry date can't have it taken away.
      if (before.hasExpiry && !next.expiryDate) throw new BadRequestException('Expiry date is required for this credential');
      if (before.hasNumber && !next.number) throw new BadRequestException('Number is required for this credential');
      const factsChanged = next.number !== before.number || next.issuedBy !== before.issuedBy || next.issueDate !== before.issue || next.expiryDate !== before.expiry;
      const notesChanged = has('notes') && fields.notes !== before.notes;
      // Saving the form without changing anything leaves the credential and its history alone.
      if (!factsChanged && !notesChanged) return getCredential(db, workerId, credentialId);
      const reset = factsChanged && before.verification !== 'unverified';
      await db.query(
        `update worker_credentials set number = $3, issue_date = $4, expiry_date = $5, issued_by = $9,
           notes = case when $6::boolean then $7 else notes end,
           verification = case when $8 then 'unverified'::verification_status else verification end,
           verified_by = case when $8 then null else verified_by end, verified_at = case when $8 then null else verified_at end,
           verification_note = case when $8 then null else verification_note end,
           rejection_reason = case when $8 then null else rejection_reason end,
           updated_at = now()
         where id = $1 and worker_id = $2`,
        [credentialId, workerId, next.number, next.issueDate, next.expiryDate, has('notes'), fields.notes, reset, next.issuedBy],
      );
      await event(db, t.tenantId, credentialId, auth.userId, 'updated', { ...next, ...(has('notes') ? { notes: fields.notes } : {}) });
      if (reset) await event(db, t.tenantId, credentialId, auth.userId, 'verification_reset', { reason: 'details changed' });
      return getCredential(db, workerId, credentialId);
    });
  }

  @Roles('owner', 'admin')
  @Post(':id/credentials/:credentialId/verify')
  verify(
    @Tenant() t: Membership, @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) workerId: string, @Param('credentialId', ParseUUIDPipe) credentialId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const note = text(body, 'note', { max: 500 });
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query(
        `update worker_credentials set verification = 'verified', verified_by = $3, verified_at = now(),
           verification_note = $4, rejection_reason = null, updated_at = now()
         where id = $1 and worker_id = $2`, [credentialId, workerId, auth.userId, note],
      );
      if (!r.rowCount) throw new NotFoundException('credential not found');
      await event(db, t.tenantId, credentialId, auth.userId, 'verified', { note });
      return getCredential(db, workerId, credentialId);
    });
  }

  @Roles('owner', 'admin')
  @Post(':id/credentials/:credentialId/reject')
  reject(
    @Tenant() t: Membership, @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) workerId: string, @Param('credentialId', ParseUUIDPipe) credentialId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const reason = text(body, 'reason', { required: true, max: 500 });
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query(
        `update worker_credentials set verification = 'rejected', rejection_reason = $3, verified_by = $4, verified_at = now(),
           verification_note = null, updated_at = now()
         where id = $1 and worker_id = $2`, [credentialId, workerId, reason, auth.userId],
      );
      if (!r.rowCount) throw new NotFoundException('credential not found');
      await event(db, t.tenantId, credentialId, auth.userId, 'rejected', { reason });
      return getCredential(db, workerId, credentialId);
    });
  }

  @Roles(...OFFICE_ROLES)
  @Get(':id/credentials/:credentialId/history')
  history(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) workerId: string, @Param('credentialId', ParseUUIDPipe) credentialId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const owns = await db.query('select 1 from worker_credentials where id = $1 and worker_id = $2', [credentialId, workerId]);
      if (!owns.rowCount) throw new NotFoundException('credential not found');
      // Names of who did what come from the sign-in records via a safe lookup, not the users table.
      return (await db.query(
        `select e.at, e.action, e.details, e.actor_user_id as "actorUserId"
           from credential_events e where e.worker_credential_id = $1 order by e.at`, [credentialId],
      )).rows;
    });
  }
}

function credentialFields(body: Record<string, unknown>) {
  const f = {
    number: text(body, 'number', { max: 100 }),
    issuedBy: text(body, 'issuedBy', { max: 120 }),
    issueDate: date(body, 'issueDate'),
    expiryDate: date(body, 'expiryDate'),
    notes: text(body, 'notes', { max: 2000 }),
  };
  if (f.issueDate && f.expiryDate && f.expiryDate < f.issueDate) throw new BadRequestException('Expiry date must be on or after the issue date');
  return f;
}

async function event(db: PoolClient, tenantId: string, credentialId: string, userId: string, action: string, details: object) {
  await db.query(
    `insert into credential_events(tenant_id, worker_credential_id, actor_user_id, action, details) values ($1,$2,$3,$4,$5)`,
    [tenantId, credentialId, userId, action, JSON.stringify(details)],
  );
}

async function getCredential(db: PoolClient, workerId: string, credentialId: string) {
  return (await db.query(
    `select ${CRED_COLUMNS} from worker_credentials c join credential_types t on t.id = c.credential_type_id
      where c.id = $1 and c.worker_id = $2`, [credentialId, workerId],
  )).rows[0];
}
