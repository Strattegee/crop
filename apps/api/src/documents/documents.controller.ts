import {
  BadRequestException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post,
  ServiceUnavailableException, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { createHash, randomUUID } from 'node:crypto';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { DOCUMENT_STORE, type DocumentStore } from './document-store.js';
import { cleanFilename, sniffType } from './sniff.js';

export const MAX_BYTES = 10 * 1024 * 1024;
const LINK_SECONDS = 300;
const COLS = `d.id, d.filename, d.content_type as "contentType", d.size_bytes as "sizeBytes", d.uploaded_at as "uploadedAt"`;

/** Evidence files for a worker's credential (spec CRD-3, CRD-4). */
@ApiBearerAuth()
@Controller('workers/:workerId/credentials/:credentialId/documents')
export class DocumentsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool, @Inject(DOCUMENT_STORE) private readonly store: DocumentStore) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Param('workerId', ParseUUIDPipe) workerId: string, @Param('credentialId', ParseUUIDPipe) credentialId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      await credentialOf(db, workerId, credentialId);
      return (await db.query(`select ${COLS} from credential_documents d where d.worker_credential_id = $1 and d.removed_at is null order by d.uploaded_at`, [credentialId])).rows;
    });
  }

  @Roles(...OFFICE_ROLES)
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async upload(
    @Tenant() t: Membership, @Auth() auth: AuthContext,
    @Param('workerId', ParseUUIDPipe) workerId: string, @Param('credentialId', ParseUUIDPipe) credentialId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!this.store.configured) throw new ServiceUnavailableException('Document storage is not set up yet');
    if (!file?.buffer?.length) throw new BadRequestException('Choose a file to upload');
    const contentType = sniffType(file.buffer);
    if (!contentType) throw new BadRequestException('Only PDF, JPEG, PNG or HEIC files can be uploaded');
    const filename = cleanFilename(file.originalname);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    // Check the credential belongs to this agency before storing anything.
    await withTenant(this.pool, t.tenantId, db => credentialOf(db, workerId, credentialId));
    const key = `${t.tenantId}/credential-documents/${randomUUID()}`;
    await this.store.put(key, file.buffer, contentType);

    return withTenant(this.pool, t.tenantId, async db => {
      const doc = (await db.query(
        `insert into credential_documents as d (tenant_id, worker_credential_id, storage_key, filename, content_type, size_bytes, sha256, uploaded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${COLS}`,
        [t.tenantId, credentialId, key, filename, contentType, file.size, sha256, auth.userId],
      )).rows[0];
      await db.query(`update worker_credentials set evidence = 'uploaded', updated_at = now() where id = $1`, [credentialId]);
      await event(db, t.tenantId, credentialId, auth.userId, 'evidence_added', { documentId: doc.id, filename });
      return doc;
    });
  }

  /** A link valid for 5 minutes that opens the file. */
  @Roles(...OFFICE_ROLES)
  @Get(':documentId/link')
  link(
    @Tenant() t: Membership,
    @Param('workerId', ParseUUIDPipe) workerId: string, @Param('credentialId', ParseUUIDPipe) credentialId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    if (!this.store.configured) throw new ServiceUnavailableException('Document storage is not set up yet');
    return withTenant(this.pool, t.tenantId, async db => {
      await credentialOf(db, workerId, credentialId);
      const d = (await db.query<{ storage_key: string; filename: string; content_type: string }>(
        `select storage_key, filename, content_type from credential_documents where id = $1 and worker_credential_id = $2 and removed_at is null`,
        [documentId, credentialId],
      )).rows[0];
      if (!d) throw new NotFoundException('document not found');
      return { url: await this.store.signedUrl(d.storage_key, d.filename, d.content_type, LINK_SECONDS), expiresInSeconds: LINK_SECONDS };
    });
  }

  /** Removes a document from the credential. The file is kept in storage and the history records who removed it. */
  @Roles(...OFFICE_ROLES)
  @Delete(':documentId')
  remove(
    @Tenant() t: Membership, @Auth() auth: AuthContext,
    @Param('workerId', ParseUUIDPipe) workerId: string, @Param('credentialId', ParseUUIDPipe) credentialId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return withTenant(this.pool, t.tenantId, async db => {
      await credentialOf(db, workerId, credentialId);
      const r = await db.query<{ filename: string }>(
        `update credential_documents set removed_at = now(), removed_by = $3
          where id = $1 and worker_credential_id = $2 and removed_at is null returning filename`,
        [documentId, credentialId, auth.userId],
      );
      if (!r.rowCount) throw new NotFoundException('document not found');
      const left = await db.query('select 1 from credential_documents where worker_credential_id = $1 and removed_at is null', [credentialId]);
      if (!left.rowCount) await db.query(`update worker_credentials set evidence = 'missing', updated_at = now() where id = $1`, [credentialId]);
      await event(db, t.tenantId, credentialId, auth.userId, 'evidence_removed', { documentId, filename: r.rows[0].filename });
      return { removed: true };
    });
  }
}

async function credentialOf(db: PoolClient, workerId: string, credentialId: string) {
  const r = await db.query('select 1 from worker_credentials where id = $1 and worker_id = $2', [credentialId, workerId]);
  if (!r.rowCount) throw new NotFoundException('{Credential} not found');
}

async function event(db: PoolClient, tenantId: string, credentialId: string, userId: string, action: string, details: object) {
  await db.query(
    `insert into credential_events(tenant_id, worker_credential_id, actor_user_id, action, details) values ($1,$2,$3,$4,$5)`,
    [tenantId, credentialId, userId, action, JSON.stringify(details)],
  );
}
