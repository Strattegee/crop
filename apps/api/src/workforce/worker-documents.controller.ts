import {
  BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post,
  ServiceUnavailableException, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { DOCUMENT_STORE, type DocumentStore } from '../documents/document-store.js';
import { MAX_BYTES } from '../documents/documents.controller.js';
import { checkAndStore } from '../documents/file-checks.js';
import { documentLabel, documentRefusal, parseDocumentFields } from './worker-documents.js';

const LINK_SECONDS = 300;
const COLS = `d.id, d.kind, d.title, d.filename, d.content_type as "contentType", d.size_bytes as "sizeBytes", d.source, d.uploaded_at as "uploadedAt"`;
type Row = { id: string; kind: string; title: string | null; filename: string; contentType: string; sizeBytes: number; source: string; uploadedAt: Date };
const shape = (r: Row) => ({ ...r, label: documentLabel(r) });

async function personOf(db: PoolClient, workerId: string) {
  return (await db.query<{ status: string }>('select status from workers where id = $1', [workerId])).rows[0];
}

/**
 * Documents kept on a person's record (backlog item 11): a CV (also kept from their online application), a signed
 * contract or another document. Office roles only (supervisors never: the table refuses them too); not for agency people.
 */
@ApiBearerAuth()
@Controller()
export class WorkerDocumentsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool, @Inject(DOCUMENT_STORE) private readonly store: DocumentStore) {}

  @Roles(...OFFICE_ROLES)
  @Get('workers/:id/documents')
  list(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await personOf(db, id);
      if (!w || w.status === 'agency') throw new NotFoundException('Person not found');
      const rows = (await db.query<Row>(
        `select ${COLS} from worker_documents d where d.worker_id = $1 and d.removed_at is null
          order by case d.kind when 'cv' then 0 when 'contract' then 1 else 2 end, d.uploaded_at desc`, [id])).rows;
      return { documents: rows.map(shape) };
    });
  }

  @Roles(...OFFICE_ROLES)
  @Post('workers/:id/documents')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: {
    file: { type: 'string', format: 'binary' }, kind: { type: 'string', enum: ['cv', 'contract', 'other'] }, title: { type: 'string' },
  } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async upload(
    @Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>, @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const fields = parseDocumentFields(body ?? {});
    if ('problem' in fields) throw new BadRequestException(fields.problem);
    // Check the person before storing anything.
    const check = async (db: PoolClient) => {
      const w = await personOf(db, id);
      const kept = Number((await db.query<{ n: string }>('select count(*) as n from worker_documents where worker_id = $1 and removed_at is null', [id])).rows[0].n);
      const refusal = documentRefusal(w, kept);
      if (refusal) throw refusal === 'Person not found' ? new NotFoundException(refusal) : new BadRequestException(refusal);
    };
    await withTenant(this.pool, t.tenantId, check);
    const f = await checkAndStore(this.store, t.tenantId, file, 'worker-documents');
    return withTenant(this.pool, t.tenantId, async db => {
      await check(db);
      const r = (await db.query<Row>(
        `insert into worker_documents as d (tenant_id, worker_id, kind, title, storage_key, filename, content_type, size_bytes, sha256, source, uploaded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'office',$10) returning ${COLS}`,
        [t.tenantId, id, fields.kind, fields.title, f.key, f.filename, f.contentType, f.size, f.sha256, auth.userId])).rows[0];
      return shape(r);
    });
  }

  /** A link valid for 5 minutes that opens the file. */
  @Roles(...OFFICE_ROLES)
  @Get('worker-documents/:id/link')
  link(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    if (!this.store.configured) throw new ServiceUnavailableException('Document storage is not set up yet');
    return withTenant(this.pool, t.tenantId, async db => {
      const d = (await db.query<{ storage_key: string; filename: string; content_type: string }>(
        'select storage_key, filename, content_type from worker_documents where id = $1 and removed_at is null', [id])).rows[0];
      if (!d) throw new NotFoundException('Document not found');
      return { url: await this.store.signedUrl(d.storage_key, d.filename, d.content_type, LINK_SECONDS), expiresInSeconds: LINK_SECONDS };
    });
  }

  /** Takes a document off the record. The file stays in storage and the audit log shows who removed it. */
  @Roles(...OFFICE_ROLES)
  @Post('worker-documents/:id/remove')
  @HttpCode(200)
  remove(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query<{ filename: string }>(
        'update worker_documents set removed_at = now(), removed_by = $2 where id = $1 and removed_at is null returning filename', [id, auth.userId]);
      if (!r.rowCount) throw new NotFoundException('Document not found');
      return { removed: true, filename: r.rows[0].filename };
    });
  }
}
