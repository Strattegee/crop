import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import type { CountryCode } from '../common/countries.js';
import { bool, oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { queueNotification, queuePush } from '../notifications/notify.js';
import { actorOf } from '../roster/publishing.js';
import { requireLinked } from '../worker-app/worker-app.controller.js';
import { tellOffice } from '../worker-app/tell-office.js';
import { addAddress, correctAddress, correctionBody, listFor, liveAddress, lockWorker, makeAddressCurrent, removeAddress } from './addresses.controller.js';
import { parseAddress } from './addresses.js';
import {
  ADDRESS_ACTIONS, DETAIL_LABEL, accessField, changeRefusal, changeWhat, decideRefusal, decidedMessage, isDetailField, parseAsked,
  sameValue, toApproveEmail, valueLine, type AddressAction, type Asked, type DetailField, type DetailStatus,
} from './detail-changes.js';
import { loadFieldAccess } from './field-access.controller.js';
import { FIELD_RULES, PERSON_FIELDS, personCan, type PersonField } from './field-access.js';
import { loadSettings } from './settings.js';

const GENDER_WORD: Record<string, string> = { F: 'Female', M: 'Male' };

type WorkerDetails = { first_name: string; last_name: string; preferred_name: string | null; email: string | null; phone: string | null; gender: string | null };

const workerDetails = async (db: PoolClient, workerId: string) =>
  (await db.query<WorkerDetails>('select first_name, last_name, preferred_name, email, phone, gender from workers where id = $1', [workerId])).rows[0];

/** The value a change would replace, in the same shape as the change (null for adding an address). */
async function currentValue(db: PoolClient, workerId: string, f: DetailField, addressId: string | null): Promise<Asked | null> {
  if (f === 'address') {
    if (!addressId) return null;
    const a = (await db.query('select label, line1, line2, suburb, region, postcode, country from worker_addresses where id = $1 and worker_id = $2', [addressId, workerId])).rows[0];
    return a ?? null;
  }
  const w = await workerDetails(db, workerId);
  if (!w) return null;
  switch (f) {
    case 'name': return { firstName: w.first_name, lastName: w.last_name };
    case 'preferred_name': return { value: w.preferred_name };
    case 'email': return { value: w.email };
    case 'mobile': return { value: w.phone };
    case 'gender': return { value: w.gender };
  }
}

/** Makes the change (the person's own, or one the office approved). Every step goes through the usual rules. */
async function applyChange(db: PoolClient, tenantId: string, workerId: string, f: DetailField, action: AddressAction | null, addressId: string | null, asked: Asked | null) {
  const one = (asked as { value?: string | null } | null)?.value ?? null;
  try {
    switch (f) {
      case 'name': {
        const n = asked as { firstName: string; lastName: string };
        await db.query('update workers set first_name = $2, last_name = $3, updated_at = now() where id = $1', [workerId, n.firstName, n.lastName]);
        return;
      }
      case 'preferred_name': await db.query('update workers set preferred_name = $2, updated_at = now() where id = $1', [workerId, one]); return;
      case 'email': await db.query('update workers set email = $2, updated_at = now() where id = $1', [workerId, one]); return;
      case 'mobile': await db.query('update workers set phone = $2, updated_at = now() where id = $1', [workerId, one]); return;
      case 'gender': await db.query('update workers set gender = $2, updated_at = now() where id = $1', [workerId, one]); return;
      case 'address': {
        await lockWorker(db, workerId);
        if (action === 'add') return addAddress(db, tenantId, workerId, asked as never, null);
        const a = await liveAddress(db, addressId!, workerId);
        if (action === 'correct') return correctAddress(db, tenantId, a, asked as never);
        if (action === 'current') return makeAddressCurrent(db, a);
        await removeAddress(db, a, 'Taken off in the app');
        return;
      }
    }
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new ConflictException('Someone else here already uses that email');
    throw err;
  }
}

const REQ_COLS = `r.id, r.worker_id as "workerId", r.field, r.address_action as "action", r.address_id as "addressId", r.asked, r.was,
  r.status, r.created_at as "createdAt", r.decided_at as "decidedAt", r.decided_by_name as "decidedByName", r.decided_note as "decidedNote"`;
type ReqRow = {
  id: string; workerId: string; field: DetailField; action: AddressAction | null; addressId: string | null; asked: Asked | null; was: Asked | null;
  status: DetailStatus; createdAt: string; decidedAt: string | null; decidedByName: string | null; decidedNote: string | null;
};

const words = (r: ReqRow, home: CountryCode) => ({
  what: changeWhat(r.field, r.action),
  askedLine: r.action === 'current' || r.action === 'remove' ? valueLine(r.field, r.was, home) : valueLine(r.field, r.asked, home),
  wasLine: r.action === 'add' ? null : valueLine(r.field, r.was, home),
});

/** The person's own view of their details, as the business lets them see them, with their changes waiting or lately decided. */
export async function myDetails(db: PoolClient, tenantId: string, workerId: string) {
  const access = await loadFieldAccess(db);
  const home = (await loadSettings(db, tenantId)).country;
  const w = await workerDetails(db, workerId);
  const value: Record<Exclude<PersonField, 'addresses'>, string | null> = {
    name: `${w.first_name} ${w.last_name}`, preferred_name: w.preferred_name, email: w.email, mobile: w.phone,
    gender: w.gender ? GENDER_WORD[w.gender] ?? null : null,
  };
  const raw: Record<Exclude<PersonField, 'addresses'>, unknown> = {
    name: { firstName: w.first_name, lastName: w.last_name }, preferred_name: w.preferred_name, email: w.email, mobile: w.phone, gender: w.gender,
  };
  const fields = PERSON_FIELDS.filter(f => f !== 'addresses' && personCan(access[f]).see).map(f => {
    const can = personCan(access[f]);
    const k = f as Exclude<PersonField, 'addresses'>;
    return { field: f, label: FIELD_RULES[f].label, value: value[k], raw: raw[k], canChange: can.change, needsApproval: can.needsApproval };
  });
  const addr = personCan(access.addresses);
  let addresses = null;
  if (addr.see) {
    const list = await listFor(db, tenantId, workerId);
    const shown = (a: NonNullable<typeof list.current>) => ({
      id: a.id, label: a.label, line: a.line, current: a.current,
      fields: { label: a.label, line1: a.line1, line2: a.line2, suburb: a.suburb, state: a.region, postcode: a.postcode, country: a.country },
    });
    addresses = {
      canChange: addr.change, needsApproval: addr.needsApproval,
      list: [...(list.current ? [shown(list.current)] : []), ...list.others.map(shown)],
    };
  }
  // Only changes to fields they can still see; the office's note was written for them.
  const seen = (f: DetailField) => personCan(access[accessField(f)]).see;
  const rows = (await db.query<ReqRow>(
    `select ${REQ_COLS} from detail_change_requests r
      where r.worker_id = $1 and (r.status = 'pending' or (r.status in ('approved', 'declined') and r.decided_at > now() - interval '14 days'))
      order by r.created_at desc limit 30`, [workerId])).rows.filter(r => seen(r.field));
  const changes = rows.map(r => {
    const t = words(r, home);
    return { id: r.id, field: r.field, addressId: r.addressId, label: DETAIL_LABEL[r.field], what: t.what, line: t.askedLine, status: r.status,
      createdAt: r.createdAt, decidedAt: r.decidedAt, note: r.decidedNote, canWithdraw: r.status === 'pending' };
  });
  return { country: home, fields, addresses, changes };
}

/**
 * Changing your own details in the app (David, 3 Nov 2026, answer 5; migration 0087), and the office approving the
 * ones the business's settings say need approval. The office's own edits (`PATCH /workers/:id`, the address
 * endpoints) are unchanged; the office always sees and changes everything.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class DetailChangesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /**
   * The person's own details: each field they may see with its value and whether they can change it (and whether the
   * office approves), their addresses when shown, and their changes waiting or decided in the last 14 days. Never the
   * date of birth, the office's notes or anything the office keeps to itself.
   */
  @Get('my/details')
  mine(@Tenant() t: Membership, @Auth() auth: AuthContext) {
    return withTenant(this.pool, t.tenantId, async db => myDetails(db, t.tenantId, (await requireLinked(db, auth)).id));
  }

  /**
   * `{ field, value }` (`firstName` + `lastName` for the name; for an address `action` add|correct|current|remove,
   * `addressId` unless adding, and the address fields when adding or correcting). Applied at once when the business
   * lets them change it (`outcome: 'changed'`), otherwise kept for an owner or admin (`outcome: 'requested'`).
   */
  @Post('my/details')
  @HttpCode(200)
  change(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const b = body ?? {};
    if (!isDetailField(b.field)) throw new BadRequestException('Choose what to change');
    const field = b.field;
    const action = field === 'address' ? oneOf(b, 'action', ADDRESS_ACTIONS, { required: true }) : null;
    const addressId = field === 'address' && action !== 'add' ? text(b, 'addressId', { required: true, max: 40 }) : null;
    if (addressId && !/^[0-9a-f-]{36}$/i.test(addressId)) throw new BadRequestException('Choose an address');
    return withTenant(this.pool, t.tenantId, async db => {
      const me = await requireLinked(db, auth);
      const access = (await loadFieldAccess(db))[accessField(field)];
      const refusal = changeRefusal(field, access);
      if (refusal) throw new ConflictException(refusal);
      const home = (await loadSettings(db, t.tenantId)).country;
      let asked: Asked | null;
      if (field === 'address' && addressId) {
        await lockWorker(db, me.id);
        const a = await liveAddress(db, addressId, me.id);
        if (action === 'correct') {
          const parsed = parseAddress(correctionBody(a, b), home);
          if ('problem' in parsed) throw new BadRequestException(parsed.problem);
          asked = parsed.address;
        } else {
          if (action === 'current' && a.current) throw new BadRequestException('That is already your current address');
          asked = null;
        }
      } else {
        const parsed = parseAsked(field, b, home, action ?? undefined);
        if ('problem' in parsed) throw new BadRequestException(parsed.problem);
        asked = parsed.asked;
      }
      const was = await currentValue(db, me.id, field, addressId);
      if (field !== 'address' || action === 'correct') {
        if (sameValue(asked, was)) throw new BadRequestException('That’s what we have already');
      }
      if (!personCan(access).needsApproval) {
        await applyChange(db, t.tenantId, me.id, field, action, addressId, asked);
        return { outcome: 'changed' as const, details: await myDetails(db, t.tenantId, me.id) };
      }
      let requestId: string;
      try {
        await db.query('savepoint ask');
        requestId = (await db.query<{ id: string }>(
          `insert into detail_change_requests(tenant_id, worker_id, field, address_action, address_id, asked, was, requested_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`, [t.tenantId, me.id, field, action, addressId, asked, was, auth.userId])).rows[0].id;
        await db.query('release savepoint ask');
      } catch (err) {
        if ((err as { code?: string }).code !== '23505') throw err;
        await db.query('rollback to savepoint ask');
        throw new ConflictException('You’ve already asked to change this: withdraw that first if it needs to be different');
      }
      const business = t.tenantName;
      const appUrl = process.env.APP_URL || null;
      const m = toApproveEmail(me.name, changeWhat(field, action), business, appUrl ? `${appUrl.replace(/\/$/, '')}/dashboard` : null);
      await tellOffice(db, t.tenantId, {
        subject: m.subject, body: m.body, template: 'detail_change_to_approve',
        dedupeKey: `detail-change-asked:${requestId}`, createdBy: auth.userId, exceptEmail: auth.email,
      });
      return { outcome: 'requested' as const, details: await myDetails(db, t.tenantId, me.id) };
    });
  }

  /** The person takes back a change still waiting. */
  @Post('my/detail-changes/:id/withdraw')
  @HttpCode(200)
  withdraw(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const me = await requireLinked(db, auth);
      const r = (await db.query<{ status: DetailStatus }>('select status from detail_change_requests where id = $1 and worker_id = $2 for update', [id, me.id])).rows[0];
      if (!r) throw new NotFoundException('Change not found');
      if (r.status !== 'pending') throw new ConflictException('The office has already decided this change');
      await db.query(`update detail_change_requests set status = 'withdrawn', decided_at = now() where id = $1`, [id]);
      return myDetails(db, t.tenantId, me.id);
    });
  }

  /**
   * Changes people asked for in the app (`status` pending (default) | all; `workerId` for one person). Each row says
   * what they asked, what it was then and what it is now (the office may have changed it since).
   */
  @Roles(...OFFICE_ROLES)
  @Get('detail-changes')
  list(@Tenant() t: Membership, @Query() q: Record<string, unknown>) {
    const status = oneOf(q, 'status', ['pending', 'all'] as const) ?? 'pending';
    const workerId = text(q, 'workerId', { max: 40 });
    if (workerId && !/^[0-9a-f-]{36}$/i.test(workerId)) throw new BadRequestException('Choose a person');
    return withTenant(this.pool, t.tenantId, async db => {
      const home = (await loadSettings(db, t.tenantId)).country;
      const rows = (await db.query<ReqRow & { workerName: string }>(
        `select ${REQ_COLS}, w.first_name || ' ' || w.last_name as "workerName" from detail_change_requests r join workers w on w.id = r.worker_id
          where ($1 = 'all' or r.status = 'pending') and ($2::uuid is null or r.worker_id = $2)
          order by (r.status = 'pending') desc, r.created_at desc limit 200`, [status, workerId])).rows;
      const canDecide = t.role === 'owner' || t.role === 'admin';
      const out = [];
      for (const r of rows) {
        const now = r.status === 'pending' && r.action !== 'add' ? await currentValue(db, r.workerId, r.field, r.addressId) : null;
        const w = words(r, home);
        out.push({
          ...r, label: DETAIL_LABEL[r.field], ...w,
          nowLine: now && !sameValue(now, r.was) ? valueLine(r.field, now, home) : null,
          canDecide: canDecide && r.status === 'pending',
        });
      }
      return { changes: out };
    });
  }

  /** `{ note?, tell? }`. Makes the change they asked for (through the usual rules) and tells them. */
  @Roles('owner', 'admin')
  @Post('detail-changes/:id/approve')
  @HttpCode(200)
  approve(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.decide(t, auth, id, 'approved', body ?? {});
  }

  /** `{ note?, tell? }`. Leaves their details as they are and tells them (the note is for them). */
  @Roles('owner', 'admin')
  @Post('detail-changes/:id/decline')
  @HttpCode(200)
  decline(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.decide(t, auth, id, 'declined', body ?? {});
  }

  private decide(t: Membership, auth: AuthContext, id: string, outcome: 'approved' | 'declined', body: Record<string, unknown>) {
    const note = text(body, 'note', { max: 300 });
    const tell = bool(body, 'tell') ?? true;
    return withTenant(this.pool, t.tenantId, async db => {
      const r = (await db.query<ReqRow & { email: string | null; firstName: string }>(
        `select ${REQ_COLS}, w.email, coalesce(w.preferred_name, w.first_name) as "firstName"
           from detail_change_requests r join workers w on w.id = r.worker_id where r.id = $1 for update of r`, [id])).rows[0];
      if (!r) throw new NotFoundException('Change not found');
      const refusal = decideRefusal(r.status);
      if (refusal) throw new ConflictException(refusal);
      if (outcome === 'approved') await applyChange(db, t.tenantId, r.workerId, r.field, r.action, r.addressId, r.asked);
      await db.query(
        'update detail_change_requests set status = $2, decided_at = now(), decided_by = $3, decided_by_name = $4, decided_note = $5 where id = $1',
        [id, outcome, auth.userId, actorOf(auth).name, note]);
      let told: 'app' | 'email' | null = null;
      if (tell) {
        // The email they gave: an approved email change goes to the new address.
        const to = outcome === 'approved' && r.field === 'email' ? (r.asked as { value: string | null }).value : r.email;
        const m = decidedMessage(r.firstName, changeWhat(r.field, r.action), outcome, note, t.tenantName);
        const n = await queuePush(db, t.tenantId, { workerId: r.workerId, template: 'detail_change_decided', title: m.push.title, body: m.push.body, dedupeKey: `detail-change:${id}`, createdBy: auth.userId });
        if (n > 0) told = 'app';
        else if (to) {
          await queueNotification(db, t.tenantId, {
            channel: 'email', to, template: 'detail_change_decided', subject: m.email.subject, body: m.email.body,
            workerId: r.workerId, dedupeKey: `detail-change:${id}:email`, createdBy: auth.userId,
          });
          told = 'email';
        }
      }
      return { id, status: outcome, told };
    });
  }
}
