import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, text, textList } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { todayIn } from './compliance.js';
import { complianceContext, credentialFactsByWorker, rightToWorkByWorker } from './compliance-data.js';
import {
  askableItems, askMessage, CHECKLIST_BY_ROLE, checklistForRoles, defaultTitle, notReadyMessage, STEP_KINDS, stepProgress, stepsFromRequirements, summarise,
  type Step, type StepInput, type StepKind, type Tick,
} from './onboarding.js';
import { loadSettings } from './settings.js';
import { queueNotification } from '../notifications/notify.js';
import { createUploadLink } from './upload-links.controller.js';
import { recruitmentEvent } from './recruitment.controller.js';
import { uploadLinkLines, uploadLinkUrl } from './upload-links.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_STEPS = 40;
const ASK_TEMPLATE = 'onboarding_request';
/** Asking again this soon is almost always a double press. */
const ASK_AGAIN_AFTER_MINUTES = 10;

const STEP_COLS = `s.id, s.title, s.help, s.kind, s.credential_type_id as "credentialTypeId", ct.name as "typeName", ct.category, s.required`;

const nameOf = (auth: AuthContext) => auth.displayName || auth.email;

/** `steps: [{ id?, title?, help?, kind, credentialTypeId?, required? }]` — the whole list, in order. */
function stepsField(body: Record<string, unknown>): StepInput[] | null {
  const v = body?.steps;
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) throw new BadRequestException('Steps must be a list');
  if (v.length > MAX_STEPS) throw new BadRequestException(`A checklist can have up to ${MAX_STEPS} steps`);
  const ids = new Set<string>();
  const types = new Set<string>();
  return v.map((x, i) => {
    const s = (x ?? {}) as Record<string, unknown>;
    const kind = s.kind ?? 'task';
    if (!STEP_KINDS.includes(kind as StepKind)) throw new BadRequestException(`Step ${i + 1}: choose what kind of step it is`);
    let credentialTypeId: string | null = null;
    if (kind === 'credential') {
      if (typeof s.credentialTypeId !== 'string' || !UUID.test(s.credentialTypeId)) throw new BadRequestException(`Step ${i + 1}: choose the credential`);
      if (types.has(s.credentialTypeId)) throw new BadRequestException('Each credential can only be a step once');
      types.add(s.credentialTypeId);
      credentialTypeId = s.credentialTypeId;
    }
    if ((kind === 'right_to_work' || kind === 'employment') && v.filter(y => (y as Record<string, unknown>)?.kind === kind).length > 1) {
      throw new BadRequestException(kind === 'right_to_work' ? 'Right to work can only be a step once' : 'Employment terms can only be a step once');
    }
    let id: string | undefined;
    if (s.id !== undefined && s.id !== null) {
      if (typeof s.id !== 'string' || !UUID.test(s.id) || ids.has(s.id)) throw new BadRequestException(`Step ${i + 1} isn't one of this checklist's steps`);
      ids.add(s.id);
      id = s.id;
    }
    const title = text(s, 'title', { max: 120 });
    if (kind === 'task' && !title) throw new BadRequestException(`Step ${i + 1}: say what needs doing`);
    const required = bool(s, 'required');
    return { id, title: title ?? '', help: text(s, 'help', { max: 300 }), kind: kind as StepKind, credentialTypeId, required: required ?? true };
  });
}

/** The roles a checklist is for, exactly as written (rules match roles exactly). Undefined when not sent. */
const forRolesField = (body: Record<string, unknown>) => textList(body, 'forRoles', { max: 30 }) ?? undefined;

/** Replaces a checklist's steps: steps sent with their id are kept (and updated), others are marked removed. */
async function setSteps(db: PoolClient, tenantId: string, checklistId: string, steps: StepInput[]) {
  const typeIds = steps.filter(s => s.credentialTypeId).map(s => s.credentialTypeId!);
  const typeNames = new Map<string, string>();
  if (typeIds.length) {
    const rows = (await db.query<{ id: string; name: string }>('select id, name from credential_types where id = any($1)', [typeIds])).rows;
    if (rows.length !== typeIds.length) throw new BadRequestException('One of the credentials no longer exists');
    for (const r of rows) typeNames.set(r.id, r.name);
  }
  const existing = (await db.query<{ id: string; kind: string }>('select id, kind from onboarding_steps where checklist_id = $1 and removed_at is null', [checklistId])).rows;
  for (const s of steps) {
    if (!s.id) continue;
    const e = existing.find(x => x.id === s.id);
    if (!e) throw new BadRequestException(`"${s.title || s.kind}" isn't one of this checklist's steps`);
    if (e.kind !== s.kind) throw new BadRequestException('A step can’t change kind; take it out and add a new one');
  }
  const keep = steps.filter(s => s.id).map(s => s.id!);
  await db.query('update onboarding_steps set removed_at = now() where checklist_id = $1 and removed_at is null and not (id = any($2))', [checklistId, keep]);
  for (const [position, s] of steps.entries()) {
    const title = s.title || defaultTitle(s.kind, s.credentialTypeId ? typeNames.get(s.credentialTypeId) : undefined);
    if (s.id) {
      await db.query('update onboarding_steps set position = $2, title = $3, help = $4, required = $5, credential_type_id = $6 where id = $1',
        [s.id, position, title, s.help, s.required, s.credentialTypeId]);
    } else {
      await db.query(
        `insert into onboarding_steps(tenant_id, checklist_id, position, title, help, kind, credential_type_id, required) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tenantId, checklistId, position, title, s.help, s.kind, s.credentialTypeId, s.required]);
    }
  }
}

async function stepsOf(db: PoolClient, checklistId: string) {
  return (await db.query<Step & { typeName: string | null; category: string | null }>(
    `select ${STEP_COLS} from onboarding_steps s left join credential_types ct on ct.id = s.credential_type_id
      where s.checklist_id = $1 and s.removed_at is null order by s.position, s.created_at`, [checklistId])).rows;
}

async function checklistById(db: PoolClient, id: string) {
  const row = (await db.query<{ id: string }>(
    `select c.id, c.name, c.description, c.for_roles as "forRoles", c.archived_at is not null as archived,
            (select count(*)::int from worker_onboardings o where o.checklist_id = c.id and o.finished_at is null) as "inProgress"
       from onboarding_checklists c where c.id = $1`, [id])).rows[0];
  if (!row) throw new NotFoundException('Checklist not found');
  return { ...row, steps: await stepsOf(db, id) };
}

const duplicate = (err: unknown, name: string | null) =>
  (err as { code?: string }).code === '23505' ? new BadRequestException(`There is already a checklist called ${name}`) : err;

/** Progress of one live or finished onboarding (steps in checklist order, each with its state). */
export async function onboardingProgress(db: PoolClient, tenantId: string, onboardingId: string) {
  const o = (await db.query<{ id: string; workerId: string; checklistId: string; checklistName: string; startedAt: string; finishedAt: string | null; roles: string[] }>(
    `select o.id, o.worker_id as "workerId", o.checklist_id as "checklistId", c.name as "checklistName",
            o.started_at as "startedAt", o.started_by_name as "startedByName", o.finished_at as "finishedAt",
            o.finished_by_name as "finishedByName", o.outcome, o.stop_reason as "stopReason", w.roles
       from worker_onboardings o join onboarding_checklists c on c.id = o.checklist_id join workers w on w.id = o.worker_id
      where o.id = $1`, [onboardingId])).rows[0];
  if (!o) throw new NotFoundException('Onboarding not found');
  const settings = await loadSettings(db, tenantId);
  const today = todayIn(settings.timezone);
  const steps = await stepsOf(db, o.checklistId);
  const ticks = new Map<string, Tick>((await db.query<{ step_id: string; done: boolean; at: string; by_name: string | null; note: string | null }>(
    `select distinct on (step_id) step_id, done, at, by_name, note from onboarding_ticks where onboarding_id = $1 order by step_id, at desc`, [o.id],
  )).rows.map(r => [r.step_id, { done: r.done, at: r.at, byName: r.by_name, note: r.note }]));
  const hasEmployment = (await db.query(
    `select 1 from employment_terms where worker_id = $1 and withdrawn_at is null and (ends_on is null or ends_on >= $2) limit 1`, [o.workerId, today])).rowCount! > 0;
  const facts = {
    ticks, today, windowDays: settings.expiringWindowDays, hasEmployment,
    credentials: (await credentialFactsByWorker(db, [o.workerId])).get(o.workerId) ?? [],
    rightToWork: (await rightToWorkByWorker(db, [o.workerId])).get(o.workerId) ?? null,
  };
  const progress = steps.map(s => stepProgress(s, facts));
  const { roles: _roles, ...rest } = o;
  const lastAsked = (await db.query<{ at: string }>(
    `select max(created_at) as at from notifications where worker_id = $1 and template = $2 and created_at >= $3`,
    [o.workerId, ASK_TEMPLATE, o.startedAt])).rows[0]?.at ?? null;
  return {
    ...rest,
    askable: askableItems(steps, progress),
    lastAskedAt: lastAsked,
    steps: steps.map((s, i) => ({ ...s, ...progress[i], tickedAt: ticks.get(s.id)?.done ? ticks.get(s.id)!.at : null, note: ticks.get(s.id)?.note ?? null })),
    summary: summarise(steps, progress),
  };
}

/**
 * The checklist to use: the one asked for, or (for `auto`) the one that fits the person's roles (`checklistForRoles`).
 */
export async function resolveChecklist(db: PoolClient, workerId: string, checklistId: string): Promise<string> {
  if (checklistId !== CHECKLIST_BY_ROLE) {
    if (!UUID.test(checklistId)) throw new BadRequestException('Choose a checklist');
    return checklistId;
  }
  const roles = (await db.query<{ roles: string[] }>('select roles from workers where id = $1', [workerId])).rows[0]?.roles ?? [];
  const live = (await db.query<{ id: string; name: string; forRoles: string[] }>(
    `select id, name, for_roles as "forRoles" from onboarding_checklists where archived_at is null`)).rows;
  const pick = checklistForRoles(live, roles);
  if (!pick) {
    throw new BadRequestException(live.length
      ? `No checklist is for ${roles.length ? roles.join(', ') : 'someone with no roles'}: choose one`
      : 'There are no onboarding checklists yet: add one in Settings');
  }
  return pick.id;
}

async function startOnboarding(db: PoolClient, tenantId: string, auth: AuthContext, workerId: string, checklistId: string) {
  const c = (await db.query<{ archived: boolean }>('select archived_at is not null as archived from onboarding_checklists where id = $1', [checklistId])).rows[0];
  if (!c) throw new BadRequestException('Choose a checklist');
  if (c.archived) throw new BadRequestException('That checklist has been put away');
  try {
    return (await db.query<{ id: string }>(
      `insert into worker_onboardings(tenant_id, worker_id, checklist_id, started_by, started_by_name) values ($1,$2,$3,$4,$5) returning id`,
      [tenantId, workerId, checklistId, auth.userId, nameOf(auth)])).rows[0].id;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new ConflictException('This person is already being onboarded');
    throw err;
  }
}

/** Starts onboarding a person (used when adding a worker too). `hold` keeps them off the roster until it's finished. */
export async function beginOnboarding(db: PoolClient, tenantId: string, auth: AuthContext, workerId: string, checklistId: string, hold: boolean) {
  const id = await startOnboarding(db, tenantId, auth, workerId, await resolveChecklist(db, workerId, checklistId));
  if (hold) await db.query(`update workers set status = 'onboarding', updated_at = now() where id = $1 and status = 'active'`, [workerId]);
  // An applicant always moves to Onboarding on the recruitment board (never straight onto the roster).
  const was = (await db.query<{ stage: string | null }>(
    `update workers w set status = 'onboarding', recruitment_stage = null, stage_changed_at = now(), updated_at = now()
       from (select recruitment_stage from workers where id = $1) old
      where w.id = $1 and w.status = 'applicant' returning old.recruitment_stage as stage`, [workerId])).rows[0];
  if (was) await recruitmentEvent(db, tenantId, workerId, auth, 'onboarding', was.stage);
  return id;
}

/** Onboarding checklists: what a new person needs before they can work. */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class OnboardingChecklistsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get('onboarding-checklists')
  list(@Tenant() t: Membership, @Query('archived') archived?: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const ids = (await db.query<{ id: string }>(
        `select id from onboarding_checklists where ($1 or archived_at is null) order by archived_at is not null, lower(name)`, [archived === 'true'])).rows;
      return Promise.all(ids.map(r => checklistById(db, r.id)));
    });
  }

  /**
   * Adds a checklist. `forRoles` = the roles it's for (empty = anyone), so it can be chosen by role (`auto`).
   * `steps` lists them in order; or `fromRequirements: true` (optionally with `roles`) starts it
   * from the business's rules: right to work, employment terms and the credentials people must or should hold.
   */
  @Roles('owner', 'admin')
  @Post('onboarding-checklists')
  create(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { required: true, max: 80 })!;
    const description = text(body, 'description', { max: 300 });
    const steps = stepsField(body);
    const fromRequirements = bool(body, 'fromRequirements') ?? false;
    const roles = textList(body, 'roles') ?? [];
    const forRoles = forRolesField(body) ?? [];
    return withTenant(this.pool, t.tenantId, async db => {
      let id: string;
      try {
        id = (await db.query<{ id: string }>('insert into onboarding_checklists(tenant_id, name, description, for_roles) values ($1,$2,$3,$4) returning id',
          [t.tenantId, name, description, forRoles])).rows[0].id;
      } catch (err) { throw duplicate(err, name); }
      let list = steps ?? [];
      if (fromRequirements) {
        const ctx = await complianceContext(db, t.tenantId);
        const base = stepsFromRequirements(ctx.rules, roles);
        // Tasks sent alongside go after the checks.
        list = [...base, ...list.filter(s => s.kind === 'task')];
      }
      await setSteps(db, t.tenantId, id, list);
      return checklistById(db, id);
    });
  }

  /** Change the name, description, the roles it's for (`forRoles`), steps (the whole list; keep a step by sending its id) or put it away (`archived`). */
  @Roles('owner', 'admin')
  @Patch('onboarding-checklists/:id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { max: 80 });
    const description = body && 'description' in body ? text(body, 'description', { max: 300 }) : undefined;
    const archived = bool(body, 'archived');
    const forRoles = forRolesField(body);
    const steps = stepsField(body);
    return withTenant(this.pool, t.tenantId, async db => {
      try {
        const n = (await db.query(
          `update onboarding_checklists set name = coalesce($2, name), description = case when $3 then $4 else description end,
                  archived_at = case when $5::boolean is null then archived_at when $5 then coalesce(archived_at, now()) else null end,
                  for_roles = coalesce($6, for_roles)
            where id = $1`, [id, name, description !== undefined, description ?? null, archived, forRoles ?? null])).rowCount;
        if (!n) throw new NotFoundException('Checklist not found');
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new BadRequestException(name ? `There is already a checklist called ${name}` : 'There is already a checklist with that name in use');
        throw err;
      }
      if (steps) await setSteps(db, t.tenantId, id, steps);
      return checklistById(db, id);
    });
  }

  /** Everyone being onboarded now, with how far they've got (for the Dashboard). */
  @Roles(...OFFICE_ROLES)
  @Get('onboardings')
  live(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => {
      const rows = (await db.query<{ id: string; workerName: string; workerId: string }>(
        `select o.id, o.worker_id as "workerId", w.first_name || ' ' || w.last_name as "workerName"
           from worker_onboardings o join workers w on w.id = o.worker_id
          where o.finished_at is null order by o.started_at limit 200`)).rows;
      const out = [];
      for (const r of rows) {
        const p = await onboardingProgress(db, t.tenantId, r.id);
        out.push({ id: r.id, workerId: r.workerId, workerName: r.workerName, checklistName: p.checklistName, startedAt: (p as { startedAt?: string }).startedAt, summary: p.summary });
      }
      return out;
    });
  }
}

/** A person's onboarding: start it, tick tasks, finish (and make them active) or stop it. */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class WorkerOnboardingController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** The live onboarding (with each step's state) and earlier ones. */
  @Roles(...OFFICE_ROLES)
  @Get('workers/:id/onboarding')
  get(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) workerId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from workers where id = $1', [workerId])).rowCount) throw new NotFoundException('{Worker} not found');
      const live = (await db.query<{ id: string }>('select id from worker_onboardings where worker_id = $1 and finished_at is null', [workerId])).rows[0];
      const history = (await db.query(
        `select o.id, c.name as "checklistName", o.started_at as "startedAt", o.finished_at as "finishedAt", o.finished_by_name as "finishedByName",
                o.outcome, o.stop_reason as "stopReason"
           from worker_onboardings o join onboarding_checklists c on c.id = o.checklist_id
          where o.worker_id = $1 and o.finished_at is not null order by o.finished_at desc`, [workerId])).rows;
      return { current: live ? await onboardingProgress(db, t.tenantId, live.id) : null, history };
    });
  }

  /**
   * `{ checklistId?, hold? }` — checklistId `auto` (or left out) picks the checklist for the person's roles. hold
   * (default true) keeps an active person off the roster until onboarding is finished.
   */
  @Roles(...OFFICE_ROLES)
  @Post('workers/:id/onboarding')
  start(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) workerId: string, @Body() body: Record<string, unknown>) {
    const checklistId = text(body, 'checklistId', { max: 40 }) ?? CHECKLIST_BY_ROLE;
    if (checklistId !== CHECKLIST_BY_ROLE && !UUID.test(checklistId)) throw new BadRequestException('Choose a checklist');
    const hold = bool(body, 'hold') ?? true;
    return withTenant(this.pool, t.tenantId, async db => {
      const w = (await db.query<{ status: string }>('select status from workers where id = $1 for update', [workerId])).rows[0];
      if (!w) throw new NotFoundException('{Worker} not found');
      if (w.status === 'offboarded') throw new BadRequestException('This person has been offboarded; change their status first');
      const id = await beginOnboarding(db, t.tenantId, auth, workerId, checklistId, hold);
      return onboardingProgress(db, t.tenantId, id);
    });
  }

  /** Ticks (or unticks) a task step: `{ done, note? }`. Steps that check records tick themselves. */
  @Roles(...OFFICE_ROLES)
  @Post('onboardings/:id/steps/:stepId/tick')
  @HttpCode(200)
  tick(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('stepId', ParseUUIDPipe) stepId: string,
    @Body() body: Record<string, unknown>) {
    const done = bool(body, 'done') ?? true;
    const note = text(body, 'note', { max: 300 });
    return withTenant(this.pool, t.tenantId, async db => {
      const o = (await db.query<{ checklist_id: string; finished_at: string | null }>('select checklist_id, finished_at from worker_onboardings where id = $1 for update', [id])).rows[0];
      if (!o) throw new NotFoundException('Onboarding not found');
      if (o.finished_at) throw new ConflictException('This onboarding is finished');
      const step = (await db.query<{ kind: string }>('select kind from onboarding_steps where id = $1 and checklist_id = $2 and removed_at is null', [stepId, o.checklist_id])).rows[0];
      if (!step) throw new NotFoundException('Step not found');
      if (step.kind !== 'task') throw new BadRequestException('This step ticks itself when the record is complete');
      await db.query('insert into onboarding_ticks(tenant_id, onboarding_id, step_id, done, note, by_user, by_name) values ($1,$2,$3,$4,$5,$6,$7)',
        [t.tenantId, id, stepId, done, note, auth.userId, nameOf(auth)]);
      return onboardingProgress(db, t.tenantId, id);
    });
  }

  /**
   * Emails the person (and texts them when `sms` is true) a list of what's still needed from them: credentials not
   * recorded yet (or run out or rejected) and right to work. `note` adds a line from the office. Things already
   * recorded and waiting to be checked, tasks and employment terms aren't asked for.
   */
  @Roles(...OFFICE_ROLES)
  @Post('onboardings/:id/ask')
  @HttpCode(200)
  ask(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const note = text(body, 'note', { max: 500 });
    const sms = bool(body, 'sms') ?? false;
    return withTenant(this.pool, t.tenantId, async db => {
      const o = (await db.query<{ worker_id: string; finished_at: string | null }>('select worker_id, finished_at from worker_onboardings where id = $1 for update', [id])).rows[0];
      if (!o) throw new NotFoundException('Onboarding not found');
      if (o.finished_at) throw new ConflictException('This onboarding is finished');
      const p = await onboardingProgress(db, t.tenantId, id);
      if (!p.askable.length) throw new BadRequestException('There is nothing to ask them for: everything they supply has been recorded');
      if (p.lastAskedAt && Date.now() - Date.parse(p.lastAskedAt) < ASK_AGAIN_AFTER_MINUTES * 60_000) {
        throw new ConflictException(`They were asked a few minutes ago. You can ask again after ${ASK_AGAIN_AFTER_MINUTES} minutes`);
      }
      const c = (await db.query<{ first: string; email: string | null; phone: string | null }>(
        'select coalesce(preferred_name, first_name) as first, email, phone from workers where id = $1', [o.worker_id])).rows[0];
      if (!c.email && !(sms && c.phone)) throw new BadRequestException(sms ? 'This person has no email address or mobile number recorded' : 'This person has no email address recorded');
      // With CROP's address known, the message carries a one-off upload link (David, 29 Oct): they send things there.
      const appUrl = process.env.APP_URL ?? '';
      let linkLines: { email: string; sms: string } | undefined;
      if (appUrl) {
        const link = await createUploadLink(db, t.tenantId, o.worker_id, id, auth.userId);
        linkLines = uploadLinkLines(uploadLinkUrl(appUrl, link.token), link.expiresAt, (await loadSettings(db, t.tenantId)).timezone);
      }
      const m = askMessage({ first: c.first, business: t.tenantName, items: p.askable, note, emailed: !!c.email, linkLines });
      const sent: string[] = [];
      if (c.email) {
        await queueNotification(db, t.tenantId, { channel: 'email', to: c.email, template: ASK_TEMPLATE, subject: m.subject, body: m.email, workerId: o.worker_id, createdBy: auth.userId });
        sent.push('email');
      }
      if (sms && c.phone) {
        const r = await queueNotification(db, t.tenantId, { channel: 'sms', to: c.phone, template: ASK_TEMPLATE, body: m.sms, workerId: o.worker_id, createdBy: auth.userId });
        if (r.status === 'queued') sent.push('text');
      }
      return { ...(await onboardingProgress(db, t.tenantId, id)), sent };
    });
  }

  /**
   * Finishes onboarding once every required step is done. `activate` (default true) makes a person who was held
   * off the roster active, so they can be rostered.
   */
  @Roles('owner', 'admin')
  @Post('onboardings/:id/finish')
  @HttpCode(200)
  finish(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const activate = bool(body, 'activate') ?? true;
    return withTenant(this.pool, t.tenantId, async db => {
      const o = (await db.query<{ worker_id: string; finished_at: string | null }>('select worker_id, finished_at from worker_onboardings where id = $1 for update', [id])).rows[0];
      if (!o) throw new NotFoundException('Onboarding not found');
      if (o.finished_at) throw new ConflictException('This onboarding is already finished');
      const p = await onboardingProgress(db, t.tenantId, id);
      if (!p.summary.ready) throw new BadRequestException(notReadyMessage(p.summary));
      await db.query(`update worker_onboardings set finished_at = now(), finished_by = $2, finished_by_name = $3, outcome = 'completed' where id = $1`,
        [id, auth.userId, nameOf(auth)]);
      let activated = false;
      if (activate) {
        activated = ((await db.query(`update workers set status = 'active', updated_at = now() where id = $1 and status in ('onboarding', 'inactive')`, [o.worker_id])).rowCount ?? 0) > 0;
        // Someone who came through the recruitment board has started.
        if (activated && (await db.query('select 1 from recruitment_events where worker_id = $1 limit 1', [o.worker_id])).rowCount) {
          await recruitmentEvent(db, t.tenantId, o.worker_id, auth, 'started', 'onboarding');
        }
      }
      return { ...(await onboardingProgress(db, t.tenantId, id)), activated };
    });
  }

  /** Stops onboarding (not going ahead): `{ reason }`. A person held off the roster becomes inactive. */
  @Roles('owner', 'admin')
  @Post('onboardings/:id/stop')
  @HttpCode(200)
  stop(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const reason = text(body, 'reason', { required: true, max: 300 });
    return withTenant(this.pool, t.tenantId, async db => {
      const o = (await db.query<{ worker_id: string; finished_at: string | null }>('select worker_id, finished_at from worker_onboardings where id = $1 for update', [id])).rows[0];
      if (!o) throw new NotFoundException('Onboarding not found');
      if (o.finished_at) throw new ConflictException('This onboarding is already finished');
      await db.query(`update worker_onboardings set finished_at = now(), finished_by = $2, finished_by_name = $3, outcome = 'stopped', stop_reason = $4 where id = $1`,
        [id, auth.userId, nameOf(auth), reason]);
      await db.query(`update workers set status = 'inactive', updated_at = now() where id = $1 and status = 'onboarding'`, [o.worker_id]);
      return onboardingProgress(db, t.tenantId, id);
    });
  }
}
