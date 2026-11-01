import {
  BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put,
  ServiceUnavailableException, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { date, int, oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { DOCUMENT_STORE, type DocumentStore } from '../documents/document-store.js';
import { MAX_BYTES } from '../documents/documents.controller.js';
import { checkAndStore } from '../documents/file-checks.js';
import { rightToWorkIssue } from './compliance.js';
import { rightToWorkByWorker } from './compliance-data.js';
import { loadSettings } from './settings.js';
import { todayIn } from './compliance.js';

const STATUSES = ['citizen', 'nz_citizen', 'permanent_resident', 'visa_holder'] as const;
const PROOFS = ['au_passport', 'birth_certificate', 'citizenship_certificate'] as const;
const COLS = `r.id, r.status, r.citizen_proof_type as "citizenProofType", r.document_number as "documentNumber",
  r.visa_type as "visaType", r.visa_subclass as "visaSubclass", r.visa_grant_number as "visaGrantNumber",
  to_char(r.visa_expiry, 'YYYY-MM-DD') as "visaExpiry", r.work_limit as "workLimit", r.work_hours_per_fortnight as "workHoursPerFortnight",
  to_char(r.vevo_checked_on, 'YYYY-MM-DD') as "vevoCheckedOn", r.vevo_result as "vevoResult", r.notes,
  r.verification, r.verified_at as "verifiedAt", r.verification_note as "verificationNote", r.rejection_reason as "rejectionReason",
  r.created_at as "createdAt", r.superseded_at as "supersededAt"`;
const DOC_COLS = `d.id, d.filename, d.content_type as "contentType", d.size_bytes as "sizeBytes", d.uploaded_at as "uploadedAt"`;

/**
 * Right to work (spec CRD-6). What's required depends on status:
 * - Australian citizen: proof (Australian passport, birth certificate or citizenship certificate).
 * - NZ citizen, permanent resident: VEVO check confirming work rights.
 * - Visa holder: visa type and subclass, expiry, work conditions (hours per fortnight if limited), and a VEVO check.
 * Saving new details replaces the current record; earlier records stay as history.
 */
@ApiBearerAuth()
@Controller('workers/:workerId/right-to-work')
export class RightToWorkController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool, @Inject(DOCUMENT_STORE) private readonly store: DocumentStore) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  get(@Tenant() t: Membership, @Param('workerId', ParseUUIDPipe) workerId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      await workerExists(db, workerId);
      const records = (await db.query<{ id: string; supersededAt: string | null }>(
        `select ${COLS} from right_to_work_records r where r.worker_id = $1 order by r.created_at desc`, [workerId],
      )).rows;
      const current = records.find(r => !r.supersededAt) ?? null;
      const settings = await loadSettings(db, t.tenantId);
      const facts = (await rightToWorkByWorker(db, [workerId])).get(workerId) ?? null;
      const issue = rightToWorkIssue(facts, todayIn(settings.timezone), settings.expiringWindowDays);
      const documents = current
        ? (await db.query(`select ${DOC_COLS} from credential_documents d where d.right_to_work_id = $1 and d.removed_at is null order by d.uploaded_at`, [current.id])).rows
        : [];
      return { current: current && { ...current, documents }, issue: issue?.problem ?? null, history: records.filter(r => r.supersededAt) };
    });
  }

  @Roles(...OFFICE_ROLES)
  @Put()
  record(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('workerId', ParseUUIDPipe) workerId: string, @Body() body: Record<string, unknown>) {
    return withTenant(this.pool, t.tenantId, async db => {
      // "Today" is the agency's date, not the server's (UTC is still yesterday on Australian mornings).
      const settings = await loadSettings(db, t.tenantId);
      const v = validate(body, todayIn(settings.timezone));
      await workerExists(db, workerId);
      const prev = (await db.query<{ id: string }>(
        `update right_to_work_records set superseded_at = now() where worker_id = $1 and superseded_at is null returning id`, [workerId],
      )).rows[0];
      const row = (await db.query<{ id: string }>(
        `insert into right_to_work_records(tenant_id, worker_id, status, citizen_proof_type, document_number, visa_type, visa_subclass,
           visa_grant_number, visa_expiry, work_limit, work_hours_per_fortnight, vevo_checked_on, vevo_result, notes, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
        [t.tenantId, workerId, v.status, v.citizenProofType, v.documentNumber, v.visaType, v.visaSubclass, v.visaGrantNumber,
          v.visaExpiry, v.workLimit, v.workHoursPerFortnight, v.vevoCheckedOn, v.vevoResult, v.notes, auth.userId],
      )).rows[0];
      if (prev) await event(db, t.tenantId, prev.id, auth.userId, 'replaced', { by: row.id });
      await event(db, t.tenantId, row.id, auth.userId, 'recorded', v);
      return (await db.query(`select ${COLS} from right_to_work_records r where r.id = $1`, [row.id])).rows[0];
    });
  }

  @Roles('owner', 'admin')
  @Post('verify')
  verify(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('workerId', ParseUUIDPipe) workerId: string, @Body() body: Record<string, unknown>) {
    const note = text(body, 'note', { max: 500 });
    return this.decide(t, auth, workerId, 'verified', note, null);
  }

  @Roles('owner', 'admin')
  @Post('reject')
  reject(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('workerId', ParseUUIDPipe) workerId: string, @Body() body: Record<string, unknown>) {
    const reason = text(body, 'reason', { required: true, max: 500 });
    return this.decide(t, auth, workerId, 'rejected', null, reason);
  }

  private decide(t: Membership, auth: AuthContext, workerId: string, outcome: 'verified' | 'rejected', note: string | null, reason: string | null) {
    return withTenant(this.pool, t.tenantId, async db => {
      const row = (await db.query<{ id: string }>(
        `update right_to_work_records set verification = $2, verified_by = $3, verified_at = now(), verification_note = $4, rejection_reason = $5
          where worker_id = $1 and superseded_at is null returning id`,
        [workerId, outcome, auth.userId, note, reason],
      )).rows[0];
      if (!row) throw new NotFoundException('No right to work details recorded yet');
      await event(db, t.tenantId, row.id, auth.userId, outcome, outcome === 'verified' ? { note } : { reason });
      return (await db.query(`select ${COLS} from right_to_work_records r where r.id = $1`, [row.id])).rows[0];
    });
  }

  @Roles(...OFFICE_ROLES)
  @Post('documents')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async upload(
    @Tenant() t: Membership, @Auth() auth: AuthContext, @Param('workerId', ParseUUIDPipe) workerId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const recordId = await withTenant(this.pool, t.tenantId, db => currentRecord(db, workerId));
    const f = await checkAndStore(this.store, t.tenantId, file, 'right-to-work');
    return withTenant(this.pool, t.tenantId, async db => {
      const doc = (await db.query(
        `insert into credential_documents as d (tenant_id, right_to_work_id, storage_key, filename, content_type, size_bytes, sha256, uploaded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${DOC_COLS}`,
        [t.tenantId, recordId, f.key, f.filename, f.contentType, f.size, f.sha256, auth.userId],
      )).rows[0];
      await event(db, t.tenantId, recordId, auth.userId, 'evidence_added', { documentId: doc.id, filename: f.filename });
      return doc;
    });
  }

  @Roles(...OFFICE_ROLES)
  @Get('documents/:documentId/link')
  link(@Tenant() t: Membership, @Param('workerId', ParseUUIDPipe) workerId: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    if (!this.store.configured) throw new ServiceUnavailableException('Document storage is not set up yet');
    return withTenant(this.pool, t.tenantId, async db => {
      const d = (await db.query<{ storage_key: string; filename: string; content_type: string }>(
        `select d.storage_key, d.filename, d.content_type from credential_documents d
           join right_to_work_records r on r.id = d.right_to_work_id
          where d.id = $1 and r.worker_id = $2 and d.removed_at is null`, [documentId, workerId],
      )).rows[0];
      if (!d) throw new NotFoundException('document not found');
      return { url: await this.store.signedUrl(d.storage_key, d.filename, d.content_type, 300), expiresInSeconds: 300 };
    });
  }

  @Roles(...OFFICE_ROLES)
  @Delete('documents/:documentId')
  remove(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('workerId', ParseUUIDPipe) workerId: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const r = (await db.query<{ right_to_work_id: string; filename: string }>(
        `update credential_documents d set removed_at = now(), removed_by = $3
           from right_to_work_records r
          where d.id = $1 and r.id = d.right_to_work_id and r.worker_id = $2 and d.removed_at is null
          returning d.right_to_work_id, d.filename`, [documentId, workerId, auth.userId],
      )).rows[0];
      if (!r) throw new NotFoundException('document not found');
      await event(db, t.tenantId, r.right_to_work_id, auth.userId, 'evidence_removed', { documentId, filename: r.filename });
      return { removed: true };
    });
  }
}

function validate(body: Record<string, unknown>, today: string) {
  const status = oneOf(body, 'status', STATUSES, { required: true })!;
  const v = {
    status,
    citizenProofType: null as string | null, documentNumber: text(body, 'documentNumber', { max: 60 }),
    visaType: null as string | null, visaSubclass: null as string | null, visaGrantNumber: null as string | null,
    visaExpiry: null as string | null, workLimit: null as string | null, workHoursPerFortnight: null as number | null,
    vevoCheckedOn: null as string | null, vevoResult: null as string | null, notes: text(body, 'notes', { max: 1000 }),
  };
  if (status === 'citizen') {
    v.citizenProofType = oneOf(body, 'citizenProofType', PROOFS, { required: true });
    return v;
  }
  v.vevoCheckedOn = date(body, 'vevoCheckedOn', { required: true });
  v.vevoResult = oneOf(body, 'vevoResult', ['confirmed', 'not_confirmed'] as const, { required: true });
  if (v.vevoCheckedOn! > today) throw new BadRequestException('VEVO check date can’t be in the future');
  if (status === 'permanent_resident') v.visaGrantNumber = text(body, 'visaGrantNumber', { max: 60 });
  if (status === 'visa_holder') {
    v.visaType = text(body, 'visaType', { required: true, max: 80 });
    v.visaSubclass = text(body, 'visaSubclass', { required: true, max: 3 });
    if (!/^\d{3}$/.test(v.visaSubclass!)) throw new BadRequestException('Visa subclass is the 3-digit number, e.g. 500');
    v.visaGrantNumber = text(body, 'visaGrantNumber', { max: 60 });
    v.visaExpiry = date(body, 'visaExpiry', { required: true });
    v.workLimit = oneOf(body, 'workLimit', ['unlimited', 'limited'] as const, { required: true });
    if (v.workLimit === 'limited') v.workHoursPerFortnight = int(body, 'workHoursPerFortnight', 1, 336) ?? (() => {
      throw new BadRequestException('Hours per fortnight is required when work is limited');
    })();
  }
  return v;
}

async function workerExists(db: PoolClient, workerId: string) {
  if (!(await db.query('select 1 from workers where id = $1', [workerId])).rowCount) throw new NotFoundException('{Worker} not found');
}

async function currentRecord(db: PoolClient, workerId: string): Promise<string> {
  const r = (await db.query<{ id: string }>('select id from right_to_work_records where worker_id = $1 and superseded_at is null', [workerId])).rows[0];
  if (!r) throw new NotFoundException('Record right to work details before uploading documents');
  return r.id;
}

async function event(db: PoolClient, tenantId: string, recordId: string, userId: string, action: string, details: object) {
  await db.query(`insert into right_to_work_events(tenant_id, record_id, actor_user_id, action, details) values ($1,$2,$3,$4,$5)`,
    [tenantId, recordId, userId, action, JSON.stringify(details)]);
}
