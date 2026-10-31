import {
  BadRequestException, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors, Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import type { AuthContext, Membership } from '../auth/auth.types.js';
import { Auth, Tenant } from '../auth/decorators.js';
import { date, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { DOCUMENT_STORE, type DocumentStore } from '../documents/document-store.js';
import { MAX_BYTES } from '../documents/documents.controller.js';
import { checkAndStore } from '../documents/file-checks.js';
import { appliesTo, credentialStatus } from '../workforce/compliance.js';
import { complianceContext, credentialFactsByWorker, rightToWorkByWorker } from '../workforce/compliance-data.js';
import { T, wordsFor } from '../terms/words.js';
import { myOnboarding, requireLinked } from './worker-app.controller.js';
import { tellOffice } from './tell-office.js';
import {
  appCredentialEmail,
  myAddRefusal, myCheckState, myCredentialDatesRefusal, myEvidenceRefusal, myNeedAddable, myNeedLine,
} from './worker-app.js';

const LEVEL_ORDER = { hard: 0, warning: 1, optional: 2 } as const;
type Level = keyof typeof LEVEL_ORDER;

/**
 * The worker app's credentials (backlog item 9): the person sees their own credentials and what their role still needs,
 * adds a credential (always unchecked: only the office verifies) and adds photos or files as evidence.
 * Nothing here can verify, edit or remove a credential; the history records each step as done in the app.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('my/credentials')
export class MyCredentialsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool, @Inject(DOCUMENT_STORE) private readonly store: DocumentStore) {}

  @Get()
  list(@Tenant() t: Membership, @Auth() auth: AuthContext) {
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      const roles = (await db.query<{ roles: string[] }>('select roles from workers where id = $1', [w.id])).rows[0].roles;
      const ctx = await complianceContext(db, t.tenantId);
      const rows = (await db.query<{
        id: string; credentialTypeId: string; typeName: string; number: string | null; issuedBy: string | null;
        issueDate: string | null; expiryDate: string | null; verification: string; needsEvidence: boolean; files: string[];
      }>(
        `select c.id, c.credential_type_id as "credentialTypeId", t.name as "typeName", c.number, c.issued_by as "issuedBy",
                to_char(c.issue_date, 'YYYY-MM-DD') as "issueDate", to_char(c.expiry_date, 'YYYY-MM-DD') as "expiryDate",
                c.verification, t.needs_evidence as "needsEvidence",
                coalesce((select json_agg(d.filename order by d.uploaded_at) from credential_documents d
                           where d.worker_credential_id = c.id and d.removed_at is null), '[]'::json) as files
           from worker_credentials c join credential_types t on t.id = c.credential_type_id
          where c.worker_id = $1 order by lower(t.name), c.expiry_date desc nulls first, c.created_at desc`, [w.id])).rows;
      const credentials = rows.map(({ verification, ...c }) => ({
        ...c, check: myCheckState(verification), status: credentialStatus(c.expiryDate, ctx.today, ctx.settings.expiringWindowDays),
        canAddFiles: myEvidenceRefusal(verification, c.files.length) === null,
      }));

      const facts = (await credentialFactsByWorker(db, [w.id])).get(w.id) ?? [];
      const rtw = (await rightToWorkByWorker(db, [w.id])).get(w.id) ?? null;
      const needs = ctx.evaluate(roles, facts, rtw).issues.map(i => ({
        credentialTypeId: i.credentialTypeId, typeName: i.typeName, must: i.severity === 'hard', problem: i.problem,
        line: myNeedLine(i), canAdd: myNeedAddable(i),
      }));

      // Credentials their onboarding checklist still needs (the office may ask for more than their role's rules).
      const start = await myOnboarding(db, t.tenantId, w.id);
      const listed = new Set(needs.map(n => n.credentialTypeId));
      const startNeeds = (start?.steps ?? []).filter(s => s.kind === 'credential' && s.yours && s.credentialTypeId && !listed.has(s.credentialTypeId));

      // What they can add: every active credential type, the ones asked of their role first (strongest level wins).
      const levels = new Map<string, Level>();
      for (const r of ctx.rules) {
        if (!appliesTo(r, roles)) continue;
        const prev = levels.get(r.credentialTypeId);
        if (!prev || LEVEL_ORDER[r.severity] < LEVEL_ORDER[prev]) levels.set(r.credentialTypeId, r.severity);
      }
      const types = (await db.query<{ id: string; name: string; hasNumber: boolean; hasExpiry: boolean }>(
        `select id, name, has_number as "hasNumber", has_expiry as "hasExpiry" from credential_types where active order by lower(name)`,
      )).rows.map(ty => ({ ...ty, level: levels.get(ty.id) ?? null }))
        .sort((a, b) => (a.level ? LEVEL_ORDER[a.level] : 3) - (b.level ? LEVEL_ORDER[b.level] : 3));

      const typeName = new Map(types.map(ty => [ty.id, ty.name]));
      for (const s of startNeeds) {
        const name = typeName.get(s.credentialTypeId!) ?? s.title;
        const problem = s.need ?? 'missing';
        needs.push({ credentialTypeId: s.credentialTypeId!, typeName: name, must: s.required, problem,
          line: myNeedLine({ typeName: name, problem, credentialTypeId: s.credentialTypeId! }), canAdd: true });
      }

      return { today: ctx.today, credentials, needs, types };
    });
  }

  /** Adds one of the person's own credentials. It starts unchecked; the office verifies it. */
  @Post()
  add(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const typeId = text(body, 'credentialTypeId', { required: true, max: 40 })!;
    if (!/^[0-9a-f-]{36}$/i.test(typeId)) throw new BadRequestException('Choose a credential');
    const fields = {
      number: text(body, 'number', { max: 100 }),
      issuedBy: text(body, 'issuedBy', { max: 120 }),
      issueDate: date(body, 'issueDate'),
      expiryDate: date(body, 'expiryDate'),
    };
    if (fields.issueDate && fields.expiryDate && fields.expiryDate < fields.issueDate) throw new BadRequestException('Expiry date must be on or after the issue date');
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      // One add at a time per person, so two quick presses can't both get past the "already waiting" check.
      await db.query('select 1 from workers where id = $1 for update', [w.id]);
      const type = (await db.query<{ name: string; category: string; has_expiry: boolean; has_number: boolean }>(
        'select name, category, has_expiry, has_number from credential_types where id = $1 and active', [typeId])).rows[0];
      if (!type) throw new NotFoundException('Not found: choose again');
      if (type.has_expiry && !fields.expiryDate) throw new BadRequestException('Expiry date is required for this credential');
      if (type.has_number && !fields.number) throw new BadRequestException('Number is required for this credential');
      const today = (await complianceContext(db, t.tenantId)).today;
      const dates = myCredentialDatesRefusal(fields.issueDate, fields.expiryDate, today);
      if (dates) throw new BadRequestException(dates);
      const waiting = !!(await db.query(
        `select 1 from worker_credentials where worker_id = $1 and credential_type_id = $2 and verification = 'unverified'`, [w.id, typeId])).rowCount;
      const refusal = myAddRefusal({ typeName: type.name, waiting });
      if (refusal) throw new ConflictException(refusal);
      const row = (await db.query<{ id: string }>(
        `insert into worker_credentials(tenant_id, worker_id, credential_type_id, number, issue_date, expiry_date, issued_by)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [t.tenantId, w.id, typeId, fields.number, fields.issueDate, fields.expiryDate, fields.issuedBy])).rows[0];
      await event(db, t.tenantId, row.id, auth.userId, 'created', { ...fields, via: 'app' });
      // Owners and admins check it, so they hear about it (never the number; a vaccination is only "a vaccination record").
      const m = appCredentialEmail({ name: w.name, workerId: w.id, typeName: type.name, category: type.category }, process.env.APP_URL ?? '', await wordsFor(db));
      await tellOffice(db, t.tenantId, { ...m, template: 'app_credential_added', dedupeKey: `app-credential:${row.id}`, createdBy: auth.userId, exceptEmail: auth.email });
      return { id: row.id, typeName: type.name, check: 'to_check' };
    });
  }

  /** Adds a photo or file (PDF, JPEG, PNG or HEIC, up to 10 MB) to one of the person's own credentials that is waiting to be checked. */
  @Post(':id/documents')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async upload(
    @Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    // Check it is theirs and may take a file before storing anything.
    await withTenant(this.pool, t.tenantId, async db => this.ownForUpload(db, auth, id));
    const stored = await checkAndStore(this.store, t.tenantId, file, 'credential-documents');
    return withTenant(this.pool, t.tenantId, async db => {
      await db.query('select 1 from worker_credentials where id = $1 for update', [id]);
      await this.ownForUpload(db, auth, id);
      const doc = (await db.query<{ id: string; filename: string }>(
        `insert into credential_documents(tenant_id, worker_credential_id, storage_key, filename, content_type, size_bytes, sha256, uploaded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, filename`,
        [t.tenantId, id, stored.key, stored.filename, stored.contentType, stored.size, stored.sha256, auth.userId])).rows[0];
      await db.query(`update worker_credentials set evidence = 'uploaded', updated_at = now() where id = $1`, [id]);
      await event(db, t.tenantId, id, auth.userId, 'evidence_added', { documentId: doc.id, filename: doc.filename, via: 'app' });
      return { id: doc.id, filename: doc.filename };
    });
  }

  private async ownForUpload(db: PoolClient, auth: AuthContext, id: string) {
    const w = await requireLinked(db, auth);
    const c = (await db.query<{ verification: string; files: number }>(
      `select c.verification, (select count(*)::int from credential_documents d where d.worker_credential_id = c.id and d.removed_at is null) as files
         from worker_credentials c where c.id = $1 and c.worker_id = $2`, [id, w.id])).rows[0];
    if (!c) throw new NotFoundException('Credential not found');
    const refusal = myEvidenceRefusal(c.verification, c.files, (await wordsFor(db)).lower(T.credential));
    if (refusal) throw new ConflictException(refusal);
  }
}

async function event(db: PoolClient, tenantId: string, credentialId: string, userId: string, action: string, details: object) {
  await db.query(
    `insert into credential_events(tenant_id, worker_credential_id, actor_user_id, action, details) values ($1,$2,$3,$4,$5)`,
    [tenantId, credentialId, userId, action, JSON.stringify(details)],
  );
}
