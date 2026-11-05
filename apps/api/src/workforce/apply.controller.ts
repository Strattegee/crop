import {
  BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put,
  Req, ServiceUnavailableException, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { createHash, randomUUID } from 'node:crypto';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import type { Request } from 'express';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Public, Roles, Tenant } from '../auth/decorators.js';
import { bool, text } from '../common/validate.js';
import type { CountryCode } from '../common/countries.js';
import { APP_POOL } from '../database/database.module.js';
import { DOCUMENT_STORE, type DocumentStore } from '../documents/document-store.js';
import { MAX_BYTES } from '../documents/documents.controller.js';
import { cleanFilename, sniffType } from '../documents/sniff.js';
import { industriesOf } from '../industry/catalogue.js';
import { packsFor } from '../industry/local.js';
import { queueNotification } from '../notifications/notify.js';
import { T, wordsFor } from '../terms/words.js';
import { NOTICE_VERSION } from '../worker-app/notice.js';
import { tellOffice } from '../worker-app/tell-office.js';
import {
  answerLines, applyFloodRefusal, ApplyProblem, BUILT_IN, BUILT_IN_KEYS, clientIp, CONFIRM_HOURS, CONFIRM_TOKEN, confirmEmail, confirmState,
  confirmUrl, CUSTOM_TYPE_LABEL, formOf, FormProblem, formToken, formTokenRefusal, hashConfirmToken, HEARD_CHOICES, HEARD_LABEL, homeLabels,
  ipHash, looksAutomated, MAX_FILES, newConfirmLink, officeEmail, parseApplication, parseBuiltIn, parseCustom, rtwStatusesFor, rtwStatusLabel,
  thanksEmail, turnstileKeys, verifyTurnstile, WORK_TYPE_LABEL, WORK_TYPES, type ApplicationInput, type ApplyForm, type StoredQuestions,
} from './apply-form.js';
import { purgeExpiredApplications } from './apply-data.js';
import { recruitmentEvent } from './recruitment.controller.js';

const SLUG = /^[a-z0-9-]{2,40}$/;
const NOT_AVAILABLE = "This page isn't available. Check the address, or contact the business directly.";
const NOT_VALID = "This link isn't valid. Check you've used the whole link from your email.";
const LINK_SECONDS = 300;

/** The business's form settings (within withTenant). */
export async function loadApplyForm(db: PoolClient) {
  const r = (await db.query<{ is_open: boolean; intro: string | null; questions: StoredQuestions }>(
    'select is_open, intro, questions from apply_forms')).rows[0];
  return { open: r?.is_open ?? false, intro: r?.intro ?? null, form: formOf(r?.questions) };
}

/** The business's form key, made the first time it's needed. */
async function formKey(db: PoolClient, tenantId: string): Promise<Buffer> {
  await db.query('insert into apply_form_keys(tenant_id) values ($1) on conflict do nothing', [tenantId]);
  return (await db.query<{ key: Buffer }>('select key from apply_form_keys')).rows[0].key;
}

/** What the form offers: the business's active roles and the credentials an applicant may say they hold. */
async function formContext(db: PoolClient) {
  const country = ((await db.query<{ country: CountryCode }>('select country from tenant_settings')).rows[0]?.country ?? 'AU') as CountryCode;
  const roles = (await db.query<{ name: string }>('select name from business_roles where active order by name')).rows.map(r => r.name);
  // Vaccinations are health information: the form never asks about them.
  const credentials = (await db.query<{ id: string; name: string; code: string | null; category: string }>(
    `select id, name, catalogue_code as code, category from credential_types where active and category <> 'vaccination' order by name`)).rows;
  const applied = new Map((await db.query<{ pack_id: string; applied_at: Date }>('select pack_id, applied_at from industry_pack_applications')).rows.map(r => [r.pack_id, r.applied_at]));
  const packs = packsFor(country).map(p => ({ id: p.id, name: p.name, appliedAt: applied.get(p.id) ?? null }));
  return { country, roles, credentials, packs };
}

/** The form as the applicant sees it (also the office's preview). */
async function formView(db: PoolClient, tenantId: string, business: string, slug: string, withToken: boolean) {
  const s = await loadApplyForm(db);
  const ctx = await formContext(db);
  const w = await wordsFor(db);
  const keys = turnstileKeys(process.env);
  const { form } = s;
  const questions = BUILT_IN_KEYS
    .filter(k => form.builtIn[k] !== 'off' && !(k === 'roles' && !ctx.roles.length) && !(k === 'credentials' && !ctx.credentials.length))
    .map(k => ({ key: k, required: form.builtIn[k] === 'required' }));
  return {
    business, slug, intro: s.intro, open: s.open, country: ctx.country,
    questions, custom: form.custom,
    roles: ctx.roles.map(name => ({ name, industries: industriesOf('role', name) })),
    credentials: ctx.credentials.map(c => ({ id: c.id, name: c.name, industries: industriesOf('credential', c.name, c.code) })),
    packs: ctx.packs,
    choices: {
      workTypes: WORK_TYPES.map(v => ({ value: v, label: WORK_TYPE_LABEL[v] })),
      rightToWork: rtwStatusesFor(ctx.country).map(v => ({ value: v, label: rtwStatusLabel(v, ctx.country) })),
      heard: HEARD_CHOICES.map(v => ({ value: v, label: HEARD_LABEL[v] })),
      home: homeLabels(ctx.country),
    },
    word: { role: w.lower(T.role), roles: w.lower(T.role, true), credentials: w.lower(T.credential, true) },
    consentVersion: NOTICE_VERSION,
    maxFiles: MAX_FILES,
    turnstileSiteKey: keys?.siteKey ?? null,
    formToken: withToken ? formToken(await formKey(db, tenantId), slug, Date.now()) : null,
  };
}

const ANSWER_COLS = `a.id, a.status, a.first_name as "firstName", a.last_name as "lastName", a.email, a.mobile, a.suburb, a.region, a.postcode,
  a.country, a.roles, a.work_types as "workTypes", a.availability, a.right_to_work as "rightToWork", a.right_to_work_status as "rightToWorkStatus",
  a.drivers_licence as "driversLicence", a.own_car as "ownCar", a.credential_type_ids as "credentialTypeIds", a.about, a.heard_from as "heardFrom",
  a.heard_other as "heardOther", a.custom_answers as custom, a.consent_version as "consentVersion", a.consented_at as "consentedAt",
  a.created_at as "createdAt", a.confirmed_at as "confirmedAt", a.outcome, a.worker_id as "workerId"`;

/** Settings › Application form (function code 9200): the office reads it; owners and admins change it. */
@ApiBearerAuth()
@Controller('apply-form')
export class ApplyFormController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  private async settings(db: PoolClient, slug: string) {
    const s = await loadApplyForm(db);
    return {
      open: s.open, intro: s.intro, slug,
      builtIn: BUILT_IN_KEYS.map(k => ({ key: k, label: BUILT_IN[k].label, note: BUILT_IN[k].note, mode: s.form.builtIn[k], allowed: BUILT_IN[k].allowed })),
      custom: s.form.custom,
      customTypes: Object.entries(CUSTOM_TYPE_LABEL).map(([value, label]) => ({ value, label })),
      turnstile: !!turnstileKeys(process.env),
      waiting: (await db.query<{ n: number }>(`select count(*)::int as n from job_applications where status = 'pending' and link_expires_at > now()`)).rows[0].n,
      confirmed30: (await db.query<{ n: number }>(`select count(*)::int as n from job_applications where status = 'confirmed' and confirmed_at > now() - interval '30 days'`)).rows[0].n,
    };
  }

  @Roles(...OFFICE_ROLES)
  @Get()
  get(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, db => this.settings(db, t.tenantSlug));
  }

  /** The form as applicants see it, even while it's closed (nothing can be sent from the preview). */
  @Roles(...OFFICE_ROLES)
  @Get('preview')
  preview(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, db => formView(db, t.tenantId, t.tenantName, t.tenantSlug, false));
  }

  /** `{open?, intro?, builtIn?: {mobile: 'optional', …}, custom?: [whole list]}`; anything left out stays as it is. */
  @Roles('owner', 'admin')
  @Put()
  put(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const open = bool(body, 'open');
    const hasIntro = !!body && 'intro' in body;
    const intro = text(body, 'intro', { max: 800 });
    return withTenant(this.pool, t.tenantId, async db => {
      const cur = await loadApplyForm(db);
      let next: ApplyForm;
      try {
        next = {
          builtIn: parseBuiltIn(body?.builtIn, cur.form.builtIn),
          custom: body && 'custom' in body ? parseCustom(body.custom) : cur.form.custom,
        };
      } catch (e) {
        if (e instanceof FormProblem) throw new BadRequestException(e.message);
        throw e;
      }
      await db.query(
        `insert into apply_forms(tenant_id, is_open, intro, questions, updated_by, updated_at) values ($1,$2,$3,$4,$5, now())
         on conflict (tenant_id) do update set is_open = excluded.is_open, intro = excluded.intro, questions = excluded.questions,
           updated_by = excluded.updated_by, updated_at = now()`,
        [t.tenantId, open ?? cur.open, hasIntro ? intro : cur.intro, JSON.stringify(next), auth.userId]);
      return this.settings(db, t.tenantSlug);
    });
  }
}

type Uploaded = Express.Multer.File;

/**
 * The public application form (/apply/<slug>): no sign-in. Only for a business that has opened it; anything else is
 * "not available", so the page never says which businesses exist. An application waits until the applicant confirms
 * their email; nothing reaches the office before that.
 */
@Controller()
export class PublicApplyController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool, @Inject(DOCUMENT_STORE) private readonly store: DocumentStore) {}

  private async business(slug: string) {
    if (!SLUG.test(slug)) throw new NotFoundException(NOT_AVAILABLE);
    const t = (await this.pool.query<{ id: string; name: string }>('select id, name from tenants where slug = $1', [slug])).rows[0];
    if (!t) throw new NotFoundException(NOT_AVAILABLE);
    return t;
  }

  @Public()
  @Get('apply/:slug')
  async view(@Param('slug') slug: string) {
    const t = await this.business(slug);
    return withTenant(this.pool, t.id, async db => {
      if (!(await loadApplyForm(db)).open) throw new NotFoundException(NOT_AVAILABLE);
      return formView(db, t.id, t.name, slug, true);
    });
  }

  /**
   * Multipart: `answers` (JSON), `formToken`, `website` (the trap field), `turnstile` (when switched on), and files
   * named `cv`, `cred_<credential type id>` or `q_<question id>` (PDF, JPEG, PNG or HEIC, 10 MB each, at most 10).
   * Everything is checked before any file is stored.
   */
  @Public()
  @Post('apply/:slug')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_BYTES, files: MAX_FILES, fields: 40, fieldSize: 100_000 } }))
  async send(
    @Param('slug') slug: string, @Body() body: Record<string, unknown>, @UploadedFiles() uploaded: Uploaded[] | undefined,
    @Req() req: Request, @Headers('x-forwarded-for') forwarded?: string,
  ) {
    const t = await this.business(slug);
    const files = uploaded ?? [];
    const ip = clientIp(forwarded, req.socket?.remoteAddress);
    let answers: Record<string, unknown> = {};
    if (typeof body?.answers === 'string') {
      try { answers = JSON.parse(body.answers) as Record<string, unknown>; } catch { throw new BadRequestException('Please open the form again and send it from there.'); }
    } else if (body?.answers && typeof body.answers === 'object') answers = body.answers as Record<string, unknown>;
    const appUrl = process.env.APP_URL ?? '';

    const plan = await withTenant(this.pool, t.id, async db => {
      const s = await loadApplyForm(db);
      if (!s.open) throw new NotFoundException(NOT_AVAILABLE);
      if (looksAutomated(body)) return null;
      const key = await formKey(db, t.id);
      const refusal = formTokenRefusal(body?.formToken, key, slug, Date.now());
      if (refusal) throw new BadRequestException(refusal);
      if (!appUrl) throw new ServiceUnavailableException('Applications can’t be taken right now. Please try again later.');
      const ctx = await formContext(db);
      const names = files.map(f => f.fieldname);
      if (new Set(names).size !== names.length) throw new BadRequestException('Send one file for each question');
      let input: ApplicationInput;
      try {
        input = parseApplication(answers, s.form, { country: ctx.country, roles: ctx.roles, credentialTypeIds: ctx.credentials.map(c => c.id) }, names);
      } catch (e) {
        if (e instanceof ApplyProblem) throw new BadRequestException(e.message);
        throw e;
      }
      const hash = ipHash(key, ip);
      const c = await this.counts(db, hash, input.email);
      const flood = applyFloodRefusal(c);
      if (flood) throw new ConflictException(flood);
      return { input, hash };
    });
    if (!plan) return { received: true };

    const keys = turnstileKeys(process.env);
    if (keys && !(await verifyTurnstile(keys.secret, body?.turnstile, ip))) {
      throw new BadRequestException('We couldn’t check that you’re a person. Please reload the page and try again.');
    }
    // Files: every one checked first, then stored (keys without names).
    const checked = files.map(f => {
      const contentType = f.buffer?.length ? sniffType(f.buffer) : null;
      if (!contentType) throw new BadRequestException(`${cleanFilename(f.originalname)}: only PDF, JPEG, PNG or HEIC files can be sent`);
      return { f, contentType };
    });
    if (checked.length && !this.store.configured) throw new ServiceUnavailableException('Files can’t be received right now. Please try again without them, or later.');
    const stored: { field: string; key: string; contentType: string; filename: string; size: number; sha256: string }[] = [];
    for (const { f, contentType } of checked) {
      const key = `${t.id}/job-applications/${randomUUID()}`;
      await this.store.put(key, f.buffer, contentType);
      stored.push({ field: f.fieldname, key, contentType, filename: cleanFilename(f.originalname), size: f.size, sha256: createHash('sha256').update(f.buffer).digest('hex') });
    }

    return withTenant(this.pool, t.id, async db => {
      // One at a time per business, so the limits hold under a burst.
      await db.query(`select pg_advisory_xact_lock(hashtextextended('job-applications:' || $1, 0))`, [t.id]);
      const { input: a, hash } = plan;
      const flood = applyFloodRefusal(await this.counts(db, hash, a.email));
      if (flood) throw new ConflictException(flood);
      // Unconfirmed applications whose link ran out are cleared away (with their file rows).
      await purgeExpiredApplications(db);
      const link = newConfirmLink();
      const id = (await db.query<{ id: string }>(
        `insert into job_applications(tenant_id, first_name, last_name, email, mobile, suburb, region, postcode, country, roles, work_types, availability,
           right_to_work, right_to_work_status, drivers_licence, own_car, credential_type_ids, about, heard_from, heard_other, custom_answers,
           consent_version, consented_at, ip_hash, link_hash, link_expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22, now(), $23, $24, now() + make_interval(hours => $25))
         returning id`,
        [t.id, a.firstName, a.lastName, a.email, a.mobile, a.suburb, a.region, a.postcode, a.country, a.roles, a.workTypes,
          a.availability ? JSON.stringify(a.availability) : null, a.rightToWork, a.rightToWorkStatus, a.driversLicence, a.ownCar, a.credentialTypeIds,
          a.about, a.heardFrom, a.heardOther, JSON.stringify(a.custom), NOTICE_VERSION, hash, link.hash, CONFIRM_HOURS])).rows[0].id;
      for (const s of stored) {
        const kind = s.field === 'cv' ? 'cv' : s.field.startsWith('cred_') ? 'credential' : 'question';
        await db.query(
          `insert into job_application_files(tenant_id, application_id, kind, credential_type_id, question_id, storage_key, filename, content_type, size_bytes, sha256)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [t.id, id, kind, kind === 'credential' ? s.field.slice(5) : null, kind === 'question' ? s.field.slice(2) : null, s.key, s.filename, s.contentType, s.size, s.sha256]);
      }
      const m = confirmEmail({ firstName: a.firstName, business: t.name, url: confirmUrl(appUrl, slug, link.token) });
      await queueNotification(db, t.id, { channel: 'email', to: a.email, template: 'job_application_confirm', subject: m.subject, body: m.body, dedupeKey: `apply-confirm:${id}`, createdBy: null });
      return { received: true, confirmBy: 'email' };
    });
  }

  private async counts(db: PoolClient, ipHashValue: Buffer, email: string) {
    return (await db.query<{ ipHour: number; businessHour: number; emailDay: number }>(
      `select count(*) filter (where ip_hash = $1 and created_at > now() - interval '1 hour')::int as "ipHour",
              count(*) filter (where created_at > now() - interval '1 hour')::int as "businessHour",
              count(*) filter (where email = $2)::int as "emailDay"
         from job_applications where created_at > now() - interval '1 day'`, [ipHashValue, email])).rows[0];
  }

  private async findLink(token: string) {
    if (!CONFIRM_TOKEN.test(token)) throw new NotFoundException(NOT_VALID);
    const r = (await this.pool.query<{ tenant_id: string; application_id: string }>('select * from app_job_application_by_link($1)', [hashConfirmToken(token)])).rows[0];
    if (!r) throw new NotFoundException(NOT_VALID);
    const b = (await this.pool.query<{ name: string; slug: string }>('select name, slug from tenants where id = $1', [r.tenant_id])).rows[0];
    return { tenantId: r.tenant_id, applicationId: r.application_id, business: b.name };
  }

  /** What the confirmation page shows (first name and business only). Opening it changes nothing. */
  @Public()
  @Get('apply-confirm/:token')
  async confirmView(@Param('token') token: string) {
    const l = await this.findLink(token);
    return withTenant(this.pool, l.tenantId, async db => {
      const a = (await db.query<{ first_name: string; status: string; link_expires_at: Date }>(
        'select first_name, status, link_expires_at from job_applications where id = $1', [l.applicationId])).rows[0];
      if (!a) throw new NotFoundException(NOT_VALID);
      return { business: l.business, firstName: a.first_name, state: confirmState({ status: a.status, linkExpiresAt: a.link_expires_at }) };
    });
  }

  /**
   * Confirms the email: the applicant joins the recruitment board at Applied (or, when the email is already someone's
   * in the business, the application is added to that person's record without changing it), and the office is told.
   * Pressing it twice does nothing more.
   */
  @Public()
  @Post('apply-confirm/:token')
  @HttpCode(200)
  async confirm(@Param('token') token: string) {
    const l = await this.findLink(token);
    return withTenant(this.pool, l.tenantId, async db => {
      const a = (await db.query<ApplicationInput & { id: string; status: string; linkExpiresAt: Date }>(
        `select ${ANSWER_COLS}, a.link_expires_at as "linkExpiresAt" from job_applications a where a.id = $1 for update`, [l.applicationId])).rows[0];
      if (!a) throw new NotFoundException(NOT_VALID);
      const state = confirmState(a);
      if (state === 'confirmed') return { business: l.business, firstName: a.firstName, state };
      if (state === 'expired') throw new ConflictException('This link has run out. Please fill in the application form again.');
      await confirmApplication(db, l.tenantId, a);
      return { business: l.business, firstName: a.firstName, state: 'confirmed' as const };
    });
  }
}

const STATUS_WORDS: Record<string, string> = {
  applicant: 'an applicant', onboarding: 'being onboarded', active: 'active', inactive: 'inactive', offboarded: 'left',
};

/** Makes the applicant (or finds the person with that email), records what they sent, and tells the office and them. */
async function confirmApplication(db: PoolClient, tenantId: string, a: ApplicationInput & { id: string }) {
  const business = (await db.query<{ name: string }>('select name from tenants where id = $1', [tenantId])).rows[0].name;
  const existing = (await db.query<{ id: string; status: string }>(
    `select id, status from workers where email = $1 and status <> 'agency' for update`, [a.email])).rows[0];
  let workerId: string;
  if (existing) {
    workerId = existing.id;
  } else {
    workerId = (await db.query<{ id: string }>(
      `insert into workers(tenant_id, first_name, last_name, email, phone, roles, status, recruitment_stage, stage_changed_at)
       values ($1,$2,$3,$4,$5,$6,'applicant','applied', now()) returning id`,
      [tenantId, a.firstName, a.lastName, a.email, a.mobile, a.roles])).rows[0].id;
    await recruitmentEvent(db, tenantId, workerId, null, 'applied', null, 'Applied online');
    if (a.suburb || a.postcode) {
      await db.query(
        `insert into worker_addresses(tenant_id, worker_id, label, line1, region, postcode, country, is_current) values ($1,$2,'From their application',$3,$4,$5,$6,true)`,
        [tenantId, workerId, a.suburb ?? a.postcode, a.region, a.postcode, a.country]);
    }
    if (a.availability) {
      await db.query(`insert into availability_patterns(tenant_id, worker_id, weekday, periods)
                      select $1, $2, (d->>'weekday')::smallint, array(select jsonb_array_elements_text(d->'periods'))
                        from jsonb_array_elements($3::jsonb) d`, [tenantId, workerId, JSON.stringify(a.availability)]);
    }
    const files = (await db.query<{ credential_type_id: string; storage_key: string; filename: string; content_type: string; size_bytes: number; sha256: string }>(
      `select credential_type_id, storage_key, filename, content_type, size_bytes, sha256 from job_application_files where application_id = $1 and kind = 'credential'`, [a.id])).rows;
    const live = new Set((await db.query<{ id: string }>('select id from credential_types where active and id = any($1)', [a.credentialTypeIds])).rows.map(r => r.id));
    for (const typeId of a.credentialTypeIds.filter(id => live.has(id))) {
      const credId = (await db.query<{ id: string }>(
        `insert into worker_credentials(tenant_id, worker_id, credential_type_id) values ($1,$2,$3) returning id`, [tenantId, workerId, typeId])).rows[0].id;
      await db.query(`insert into credential_events(tenant_id, worker_credential_id, action, details) values ($1,$2,'created',$3)`,
        [tenantId, credId, JSON.stringify({ via: 'apply', applicationId: a.id })]);
      for (const f of files.filter(x => x.credential_type_id === typeId)) {
        const doc = (await db.query<{ id: string }>(
          `insert into credential_documents(tenant_id, worker_credential_id, storage_key, filename, content_type, size_bytes, sha256)
           values ($1,$2,$3,$4,$5,$6,$7) returning id`, [tenantId, credId, f.storage_key, f.filename, f.content_type, f.size_bytes, f.sha256])).rows[0];
        await db.query(`update worker_credentials set evidence = 'uploaded', updated_at = now() where id = $1`, [credId]);
        await db.query(`insert into credential_events(tenant_id, worker_credential_id, action, details) values ($1,$2,'evidence_added',$3)`,
          [tenantId, credId, JSON.stringify({ documentId: doc.id, filename: f.filename, via: 'apply' })]);
      }
    }
  }
  await db.query(`update job_applications set status = 'confirmed', confirmed_at = now(), worker_id = $2, outcome = $3 where id = $1`,
    [a.id, workerId, existing ? 'existing_person' : 'new_applicant']);
  const name = `${a.firstName} ${a.lastName}`;
  const m = officeEmail({ name, roles: a.roles, workerId, existing: existing ? STATUS_WORDS[existing.status] ?? existing.status : null }, process.env.APP_URL ?? '');
  await tellOffice(db, tenantId, { ...m, template: 'job_application', dedupeKey: `job-application:${a.id}`, createdBy: null });
  // People whose dashboard focus is recruitment hear about it too (owners and admins are already told above; the dedupe keeps it to one each).
  for (const r of (await db.query<{ email: string }>(`select email from app_office_team() where focus = 'recruitment' and role <> 'supervisor'`)).rows) {
    const to = (r.email ?? '').trim().toLowerCase();
    if (to) await queueNotification(db, tenantId, { channel: 'email', to: r.email, template: 'job_application', subject: m.subject, body: m.body, dedupeKey: `job-application:${a.id}:${to}`, createdBy: null });
  }
  const thanks = thanksEmail({ firstName: a.firstName, business });
  await queueNotification(db, tenantId, { channel: 'email', to: a.email, template: 'job_application_received', subject: thanks.subject, body: thanks.body, workerId, dedupeKey: `apply-thanks:${a.id}`, createdBy: null });
  return workerId;
}

/** The office side: a person's applications (their page) and opening the files sent with them. */
@ApiBearerAuth()
@Controller()
export class JobApplicationsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool, @Inject(DOCUMENT_STORE) private readonly store: DocumentStore) {}

  @Roles(...OFFICE_ROLES)
  @Get('workers/:id/applications')
  list(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const apps = (await db.query<ApplicationInput & { id: string; createdAt: Date; confirmedAt: Date; outcome: string; consentVersion: string; consentedAt: Date }>(
        `select ${ANSWER_COLS} from job_applications a where a.worker_id = $1 and a.status = 'confirmed' order by a.confirmed_at desc`, [id])).rows;
      if (!apps.length) return [];
      const country = ((await db.query<{ country: CountryCode }>('select country from tenant_settings')).rows[0]?.country ?? 'AU') as CountryCode;
      const names = new Map((await db.query<{ id: string; name: string }>('select id, name from credential_types where id = any($1)',
        [[...new Set(apps.flatMap(x => x.credentialTypeIds))]])).rows.map(r => [r.id, r.name]));
      const files = (await db.query<{ id: string; applicationId: string; kind: string; credentialTypeId: string | null; questionId: string | null; filename: string; sizeBytes: number }>(
        `select id, application_id as "applicationId", kind, credential_type_id as "credentialTypeId", question_id as "questionId", filename, size_bytes as "sizeBytes"
           from job_application_files where application_id = any($1) order by created_at`, [apps.map(x => x.id)])).rows;
      return apps.map(x => ({
        id: x.id, createdAt: x.createdAt, confirmedAt: x.confirmedAt, outcome: x.outcome, consentVersion: x.consentVersion, consentedAt: x.consentedAt,
        name: `${x.firstName} ${x.lastName}`, email: x.email,
        answers: answerLines(x, names, country),
        files: files.filter(f => f.applicationId === x.id).map(f => ({
          id: f.id, filename: f.filename, sizeBytes: f.sizeBytes,
          label: f.kind === 'cv' ? 'CV' : f.kind === 'credential' ? names.get(f.credentialTypeId!) ?? 'Qualification'
            : x.custom.find(c => c.id === f.questionId)?.label ?? 'File',
        })),
      }));
    });
  }

  /** A link valid for 5 minutes that opens a file sent with a confirmed application. */
  @Roles(...OFFICE_ROLES)
  @Get('job-application-files/:id/link')
  link(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    if (!this.store.configured) throw new ServiceUnavailableException('Document storage is not set up yet');
    return withTenant(this.pool, t.tenantId, async db => {
      const f = (await db.query<{ storage_key: string; filename: string; content_type: string }>(
        `select f.storage_key, f.filename, f.content_type from job_application_files f join job_applications a on a.id = f.application_id
          where f.id = $1 and a.status = 'confirmed'`, [id])).rows[0];
      if (!f) throw new NotFoundException('File not found');
      return { url: await this.store.signedUrl(f.storage_key, f.filename, f.content_type, LINK_SECONDS), expiresInSeconds: LINK_SECONDS };
    });
  }
}
