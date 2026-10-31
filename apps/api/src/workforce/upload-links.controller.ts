import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Public, Roles, Tenant } from '../auth/decorators.js';
import { bool, date, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { DOCUMENT_STORE, type DocumentStore } from '../documents/document-store.js';
import { MAX_BYTES } from '../documents/documents.controller.js';
import { checkAndStore } from '../documents/file-checks.js';
import { queueNotification } from '../notifications/notify.js';
import { T, wordsFor } from '../terms/words.js';
import { tellOffice } from '../worker-app/tell-office.js';
import { myCredentialDatesRefusal } from '../worker-app/worker-app.js';
import { complianceContext, credentialFactsByWorker, rightToWorkByWorker } from './compliance-data.js';
import { askMessage } from './onboarding.js';
import { onboardingProgress } from './onboarding.controller.js';
import { loadSettings } from './settings.js';
import {
  hashUploadToken, LINK_MAX_FILES, linkNeeds, linkState, linkUploadEmail, newUploadLink, rightToWorkNeeded, UPLOAD_LINK_DAYS,
  UPLOAD_TOKEN, uploadLinkLines, uploadLinkUrl, type LinkNeed,
} from './upload-links.js';

const NOT_VALID = "This link isn't valid. Check you've used the whole link from your message.";
const TEMPLATE = 'upload_link';

/** What's still needed from a person (within withTenant): credentials and whether right to work proof can be sent. */
export async function neededFrom(db: PoolClient, tenantId: string, workerId: string) {
  const w = (await db.query<{ roles: string[] }>('select roles from workers where id = $1', [workerId])).rows[0];
  if (!w) throw new NotFoundException('Person not found');
  const ctx = await complianceContext(db, tenantId);
  const issues = ctx.evaluate(w.roles, (await credentialFactsByWorker(db, [workerId])).get(workerId) ?? [],
    (await rightToWorkByWorker(db, [workerId])).get(workerId) ?? null).issues;
  const o = (await db.query<{ id: string }>('select id from worker_onboardings where worker_id = $1 and finished_at is null', [workerId])).rows[0];
  const steps = o ? (await onboardingProgress(db, tenantId, o.id)).steps as { kind: string; credentialTypeId: string | null; typeName: string | null; required: boolean; state: string }[] : [];
  return { needs: linkNeeds(issues, steps), rightToWork: rightToWorkNeeded(issues, steps), onboardingId: o?.id ?? null };
}

/**
 * Makes a new upload link for a person (within withTenant), stopping any earlier one still working, so only the
 * newest link sent to them works. Returns the token: it is never stored and can't be shown again.
 */
export async function createUploadLink(db: PoolClient, tenantId: string, workerId: string, onboardingId: string | null, userId: string) {
  await db.query('update upload_links set revoked_at = now() where worker_id = $1 and revoked_at is null and expires_at > now()', [workerId]);
  const { token, hash } = newUploadLink();
  const r = (await db.query<{ id: string; expires_at: Date }>(
    `insert into upload_links(tenant_id, worker_id, onboarding_id, link_hash, created_by, expires_at)
     values ($1,$2,$3,$4,$5, now() + make_interval(days => $6)) returning id, expires_at`,
    [tenantId, workerId, onboardingId, hash, userId, UPLOAD_LINK_DAYS])).rows[0];
  return { id: r.id, token, expiresAt: r.expires_at };
}

const LINK_COLS = `l.id, l.created_at as "sentAt", l.expires_at as "expiresAt", l.revoked_at as "revokedAt", l.last_used_at as "lastUsedAt"`;

/** The office side: send a person an upload link, see the latest one, stop it. */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('workers/:workerId/upload-link')
export class WorkerUploadLinkController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  latest(@Tenant() t: Membership, @Param('workerId', ParseUUIDPipe) workerId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const l = (await db.query<{ expiresAt: Date; revokedAt: Date | null }>(
        `select ${LINK_COLS} from upload_links l where l.worker_id = $1 order by l.created_at desc limit 1`, [workerId])).rows[0];
      const needed = await neededFrom(db, t.tenantId, workerId);
      const waiting = new Set((await db.query<{ id: string }>(
        `select credential_type_id as id from worker_credentials where worker_id = $1 and verification = 'unverified'`, [workerId])).rows.map(r => r.id));
      return {
        link: l ? { ...l, state: linkState(l) } : null,
        needs: needed.needs.map(n => ({ ...n, waiting: waiting.has(n.credentialTypeId) })), rightToWork: needed.rightToWork,
      };
    });
  }

  /**
   * Emails the person (and texts them when `sms` is true) what's still needed with a new upload link. `note` adds a
   * line from the office. Needs APP_URL so the link can be built.
   */
  @Roles(...OFFICE_ROLES)
  @Post()
  @HttpCode(200)
  send(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('workerId', ParseUUIDPipe) workerId: string, @Body() body: Record<string, unknown>) {
    const note = text(body, 'note', { max: 500 });
    const sms = bool(body, 'sms') ?? false;
    const appUrl = process.env.APP_URL ?? '';
    if (!appUrl) throw new ConflictException('Upload links need the web address of CROP (APP_URL) to be set');
    return withTenant(this.pool, t.tenantId, async db => {
      await db.query('select 1 from workers where id = $1 for update', [workerId]);
      const c = (await db.query<{ first: string; email: string | null; phone: string | null; status: string }>(
        'select coalesce(preferred_name, first_name) as first, email, phone, status from workers where id = $1', [workerId])).rows[0];
      if (!c || c.status === 'agency') throw new NotFoundException('Person not found');
      if (!c.email && !(sms && c.phone)) throw new BadRequestException(sms ? 'This person has no email address or mobile number recorded' : 'This person has no email address recorded');
      const needed = await neededFrom(db, t.tenantId, workerId);
      if (!needed.needs.length && !needed.rightToWork) throw new BadRequestException('There is nothing to ask them for: everything they supply has been recorded');
      const link = await createUploadLink(db, t.tenantId, workerId, needed.onboardingId, auth.userId);
      const settings = await loadSettings(db, t.tenantId);
      const lines = uploadLinkLines(uploadLinkUrl(appUrl, link.token), link.expiresAt, settings.timezone);
      const items = askItems(needed.needs, needed.rightToWork, await db.query<{ id: string; category: string }>(
        'select id, category from credential_types where id = any($1)', [needed.needs.map(n => n.credentialTypeId)]).then(r => r.rows));
      const m = askMessage({ first: c.first, business: t.tenantName, items, note, emailed: !!c.email, linkLines: lines });
      const sent: string[] = [];
      if (c.email) {
        await queueNotification(db, t.tenantId, { channel: 'email', to: c.email, template: TEMPLATE, subject: m.subject, body: m.email, workerId, createdBy: auth.userId });
        sent.push('email');
      }
      if (sms && c.phone) {
        const r = await queueNotification(db, t.tenantId, { channel: 'sms', to: c.phone, template: TEMPLATE, body: m.sms, workerId, createdBy: auth.userId });
        if (r.status === 'queued') sent.push('text');
      }
      return { sent, expiresAt: link.expiresAt };
    });
  }

  @Roles(...OFFICE_ROLES)
  @Post('stop')
  @HttpCode(200)
  stop(@Tenant() t: Membership, @Param('workerId', ParseUUIDPipe) workerId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query('update upload_links set revoked_at = now() where worker_id = $1 and revoked_at is null and expires_at > now()', [workerId]);
      return { stopped: r.rowCount ?? 0 };
    });
  }
}

/** The ask list in the message's words: vaccinations only as "a vaccination record". */
export function askItems(needs: LinkNeed[], rightToWork: boolean, types: { id: string; category: string }[]) {
  const cat = new Map(types.map(x => [x.id, x.category]));
  const seen = new Set<string>();
  const items: { label: string; required: boolean }[] = [];
  for (const n of needs) {
    const label = cat.get(n.credentialTypeId) === 'vaccination' ? 'a vaccination record' : n.typeName;
    if (seen.has(label)) continue;
    seen.add(label);
    items.push({ label, required: n.required });
  }
  if (rightToWork) items.push({ label: 'proof of your right to work (for example your passport, citizenship certificate or visa details)', required: true });
  return items;
}

/**
 * The person's side, without signing in. The token is the only credential: one person, 256 random bits, only its
 * hash stored, working for a few days. It shows their first name, the business and what's still needed, nothing
 * else; it can only add credentials of the types still needed (always unchecked) and files to those waiting to be
 * checked. GET never changes anything.
 */
@Controller('upload-links')
export class UploadLinksController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool, @Inject(DOCUMENT_STORE) private readonly store: DocumentStore) {}

  private async find(token: string) {
    if (!UPLOAD_TOKEN.test(token)) throw new NotFoundException(NOT_VALID);
    const db = await this.pool.connect();
    try {
      const r = (await db.query<{ tenant_id: string; link_id: string }>('select * from app_upload_link_by_hash($1)', [hashUploadToken(token)])).rows[0];
      if (!r) throw new NotFoundException(NOT_VALID);
      return { tenantId: r.tenant_id, linkId: r.link_id };
    } finally {
      db.release();
    }
  }

  private async link(db: PoolClient, linkId: string, forChange: boolean) {
    const l = (await db.query<{ worker_id: string; expires_at: Date; revoked_at: Date | null }>(
      `select worker_id, expires_at, revoked_at from upload_links where id = $1${forChange ? ' for update' : ''}`, [linkId])).rows[0];
    if (!l) throw new NotFoundException(NOT_VALID);
    const state = linkState({ expiresAt: l.expires_at, revokedAt: l.revoked_at });
    if (forChange && state !== 'ok') {
      throw new ConflictException(state === 'expired' ? 'This link has run out. Ask the office to send you a new one.' : 'This link has been replaced by a newer one. Use the link in your latest message.');
    }
    return { workerId: l.worker_id, expiresAt: l.expires_at, state };
  }

  private async view(db: PoolClient, tenantId: string, linkId: string) {
    const l = await this.link(db, linkId, false);
    const p = (await db.query<{ first: string; business: string }>(
      `select coalesce(w.preferred_name, w.first_name) as first, t.name as business from workers w join tenants t on t.id = w.tenant_id where w.id = $1`,
      [l.workerId])).rows[0];
    const w = await wordsFor(db);
    const base = { business: p.business, firstName: p.first, expiresAt: l.expiresAt, state: l.state, word: { one: w.one(T.credential), lower: w.lower(T.credential) } };
    if (l.state !== 'ok') return { ...base, items: [], rightToWork: null };
    const needed = await neededFrom(db, tenantId, l.workerId);
    const types = (await db.query<{ id: string; hasNumber: boolean; hasExpiry: boolean }>(
      'select id, has_number as "hasNumber", has_expiry as "hasExpiry" from credential_types where id = any($1) and active',
      [needed.needs.map(n => n.credentialTypeId)])).rows;
    const waiting = (await db.query<{ typeId: string; files: number }>(
      `select c.credential_type_id as "typeId",
              (select count(*)::int from credential_documents d where d.worker_credential_id = c.id and d.removed_at is null) as files
         from worker_credentials c where c.worker_id = $1 and c.verification = 'unverified'`, [l.workerId])).rows;
    const items = needed.needs.filter(n => types.some(t => t.id === n.credentialTypeId)).map(n => {
      const ty = types.find(t => t.id === n.credentialTypeId)!;
      const wt = waiting.find(x => x.typeId === n.credentialTypeId);
      return { ...n, hasNumber: ty.hasNumber, hasExpiry: ty.hasExpiry, sent: wt ? { files: wt.files } : null };
    });
    let rightToWork: { canSend: boolean; files: number } | null = null;
    if (needed.rightToWork) {
      const r = (await db.query<{ verification: string; files: number }>(
        `select r.verification, (select count(*)::int from credential_documents d where d.right_to_work_id = r.id and d.removed_at is null) as files
           from right_to_work_records r where r.worker_id = $1 and r.superseded_at is null`, [l.workerId])).rows[0];
      rightToWork = { canSend: !!r && r.verification !== 'verified', files: r?.files ?? 0 };
    }
    return { ...base, items, rightToWork };
  }

  @Public()
  @Get(':token')
  async get(@Param('token') token: string) {
    const { tenantId, linkId } = await this.find(token);
    return withTenant(this.pool, tenantId, db => this.view(db, tenantId, linkId));
  }

  /**
   * Sends one credential: a file (required) with its number and dates when the type has them. A credential already
   * sent and waiting to be checked gets the file added instead.
   */
  @Public()
  @Post(':token/credentials')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { credentialTypeId: { type: 'string' }, number: { type: 'string' }, issueDate: { type: 'string' }, expiryDate: { type: 'string' }, file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async credential(@Param('token') token: string, @Body() body: Record<string, unknown>, @UploadedFile() file: Express.Multer.File | undefined) {
    const typeId = text(body, 'credentialTypeId', { required: true, max: 40 })!;
    if (!/^[0-9a-f-]{36}$/i.test(typeId)) throw new BadRequestException('Choose what you are sending');
    const fields = { number: text(body, 'number', { max: 100 }), issueDate: date(body, 'issueDate'), expiryDate: date(body, 'expiryDate') };
    if (!file) throw new BadRequestException('Choose a photo or file to send');
    const { tenantId, linkId } = await this.find(token);
    // Check everything before storing the file.
    const plan = await withTenant(this.pool, tenantId, db => this.planCredential(db, tenantId, linkId, typeId, fields));
    const stored = await checkAndStore(this.store, tenantId, file, 'credential-documents');
    return withTenant(this.pool, tenantId, async db => {
      const again = await this.planCredential(db, tenantId, linkId, typeId, fields, true);
      let credentialId = again.waitingId;
      if (!credentialId) {
        credentialId = (await db.query<{ id: string }>(
          `insert into worker_credentials(tenant_id, worker_id, credential_type_id, number, issue_date, expiry_date)
           values ($1,$2,$3,$4,$5,$6) returning id`,
          [tenantId, plan.workerId, typeId, fields.number, fields.issueDate, fields.expiryDate])).rows[0].id;
        await credEvent(db, tenantId, credentialId, 'created', { ...fields, via: 'link' });
      }
      const doc = (await db.query<{ id: string; filename: string }>(
        `insert into credential_documents(tenant_id, worker_credential_id, storage_key, filename, content_type, size_bytes, sha256)
         values ($1,$2,$3,$4,$5,$6,$7) returning id, filename`,
        [tenantId, credentialId, stored.key, stored.filename, stored.contentType, stored.size, stored.sha256])).rows[0];
      await db.query(`update worker_credentials set evidence = 'uploaded', updated_at = now() where id = $1`, [credentialId]);
      await credEvent(db, tenantId, credentialId, 'evidence_added', { documentId: doc.id, filename: doc.filename, via: 'link' });
      await db.query('update upload_links set last_used_at = now() where id = $1', [linkId]);
      const what = again.category === 'vaccination' ? 'a vaccination record' : again.typeName;
      const m = linkUploadEmail({ name: again.name, workerId: plan.workerId, what }, process.env.APP_URL ?? '', await wordsFor(db));
      await tellOffice(db, tenantId, { ...m, template: 'link_credential_added', dedupeKey: `link-credential:${credentialId}`, createdBy: null });
      return this.view(db, tenantId, linkId);
    });
  }

  private async planCredential(
    db: PoolClient, tenantId: string, linkId: string, typeId: string,
    fields: { number: string | null; issueDate: string | null; expiryDate: string | null }, lock = false,
  ) {
    const l = await this.link(db, linkId, true);
    if (lock) await db.query('select 1 from workers where id = $1 for update', [l.workerId]);
    const needed = await neededFrom(db, tenantId, l.workerId);
    const waiting = (await db.query<{ id: string; files: number }>(
      `select c.id, (select count(*)::int from credential_documents d where d.worker_credential_id = c.id and d.removed_at is null) as files
         from worker_credentials c where c.worker_id = $1 and c.credential_type_id = $2 and c.verification = 'unverified'
        order by c.created_at desc limit 1`, [l.workerId, typeId])).rows[0];
    if (!needed.needs.some(n => n.credentialTypeId === typeId) && !waiting) throw new BadRequestException("That isn't one of the things asked for");
    const type = (await db.query<{ name: string; category: string; has_number: boolean; has_expiry: boolean }>(
      'select name, category, has_number, has_expiry from credential_types where id = $1 and active', [typeId])).rows[0];
    if (!type) throw new BadRequestException("That isn't one of the things asked for");
    if (waiting && waiting.files >= LINK_MAX_FILES) throw new ConflictException(`You can send up to ${LINK_MAX_FILES} files for one ${type.name}`);
    if (!waiting) {
      if (type.has_number && !fields.number) throw new BadRequestException('Number is required for this one');
      if (type.has_expiry && !fields.expiryDate) throw new BadRequestException('Expiry date is required for this one');
      if (fields.issueDate && fields.expiryDate && fields.expiryDate < fields.issueDate) throw new BadRequestException('Expiry date must be on or after the issue date');
      const dates = myCredentialDatesRefusal(fields.issueDate, fields.expiryDate, (await complianceContext(db, tenantId)).today);
      if (dates) throw new BadRequestException(dates);
    }
    const name = (await db.query<{ name: string }>(
      `select coalesce(preferred_name, first_name) || ' ' || last_name as name from workers where id = $1`, [l.workerId])).rows[0].name;
    return { workerId: l.workerId, waitingId: waiting?.id ?? null, typeName: type.name, category: type.category, name };
  }

  /** Sends a photo or file of proof of right to work, once the office has recorded their details. */
  @Public()
  @Post(':token/right-to-work')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async rightToWork(@Param('token') token: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Choose a photo or file to send');
    const { tenantId, linkId } = await this.find(token);
    await withTenant(this.pool, tenantId, db => this.planRightToWork(db, tenantId, linkId));
    const stored = await checkAndStore(this.store, tenantId, file, 'right-to-work');
    return withTenant(this.pool, tenantId, async db => {
      const p = await this.planRightToWork(db, tenantId, linkId);
      const doc = (await db.query<{ id: string }>(
        `insert into credential_documents(tenant_id, right_to_work_id, storage_key, filename, content_type, size_bytes, sha256)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [tenantId, p.recordId, stored.key, stored.filename, stored.contentType, stored.size, stored.sha256])).rows[0];
      await db.query(`insert into right_to_work_events(tenant_id, record_id, action, details) values ($1,$2,'evidence_added',$3)`,
        [tenantId, p.recordId, JSON.stringify({ documentId: doc.id, filename: stored.filename, via: 'link' })]);
      await db.query('update upload_links set last_used_at = now() where id = $1', [linkId]);
      const m = linkUploadEmail({ name: p.name, workerId: p.workerId, what: 'proof of their right to work' }, process.env.APP_URL ?? '', await wordsFor(db));
      await tellOffice(db, tenantId, { ...m, template: 'link_credential_added', dedupeKey: `link-rtw:${doc.id}`, createdBy: null });
      return this.view(db, tenantId, linkId);
    });
  }

  private async planRightToWork(db: PoolClient, tenantId: string, linkId: string) {
    const l = await this.link(db, linkId, true);
    const needed = await neededFrom(db, tenantId, l.workerId);
    if (!needed.rightToWork) throw new BadRequestException("That isn't one of the things asked for");
    const r = (await db.query<{ id: string; verification: string; files: number }>(
      `select r.id, r.verification, (select count(*)::int from credential_documents d where d.right_to_work_id = r.id and d.removed_at is null) as files
         from right_to_work_records r where r.worker_id = $1 and r.superseded_at is null for update`, [l.workerId])).rows[0];
    if (!r || r.verification === 'verified') throw new ConflictException('Please contact the office about your right to work');
    if (r.files >= LINK_MAX_FILES) throw new ConflictException(`You can send up to ${LINK_MAX_FILES} files for your right to work`);
    const name = (await db.query<{ name: string }>(
      `select coalesce(preferred_name, first_name) || ' ' || last_name as name from workers where id = $1`, [l.workerId])).rows[0].name;
    return { recordId: r.id, workerId: l.workerId, name };
  }
}

async function credEvent(db: PoolClient, tenantId: string, credentialId: string, action: string, details: object) {
  await db.query(`insert into credential_events(tenant_id, worker_credential_id, action, details) values ($1,$2,$3,$4)`,
    [tenantId, credentialId, action, JSON.stringify(details)]);
}

