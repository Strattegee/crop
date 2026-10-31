import { BadRequestException, Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import type { Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { auditSummary, fieldLabel, shownFields, TABLE_LABEL } from './audit.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
type Row = { id: string; at: Date; tableName: string; rowId: string | null; action: 'insert' | 'update' | 'delete'; actorName: string | null; via: string;
  oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null };

function shape(r: Row) {
  const fields = shownFields(r).map(k => ({ key: k, label: fieldLabel(k), old: r.oldValues?.[k] ?? null, new: r.newValues?.[k] ?? null }));
  return { id: r.id, at: r.at, table: r.tableName, what: TABLE_LABEL[r.tableName] ?? fieldLabel(r.tableName), rowId: r.rowId, action: r.action,
    by: r.actorName ?? (r.via === 'link' ? 'Someone using a link' : r.via === 'system' ? 'CROP' : null), via: r.via, summary: auditSummary(r), fields };
}

const COLS = `id::text, at, table_name as "tableName", row_id as "rowId", action, actor_name as "actorName", via, old_values as "oldValues", new_values as "newValues"`;

async function page(db: PoolClient, where: string[], params: unknown[], limit: number, before: string | undefined) {
  if (before) { params.push(before); where.push(`id < $${params.length}::bigint`); }
  params.push(limit + 1);
  const rows = (await db.query<Row>(`select ${COLS} from audit_log ${where.length ? `where ${where.join(' and ')}` : ''} order by id desc limit $${params.length}`, params)).rows;
  return { rows: rows.slice(0, limit).map(shape), more: rows.length > limit ? rows[limit - 1].id : null };
}

/**
 * The audit log (spec: every create, change and delete with who, when, and old and new values; it can't be edited).
 * Owners and admins read it; nobody can change it.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class AuditController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** `?table=&from=YYYY-MM-DD&to=YYYY-MM-DD&before=<id>&limit=` (newest first, 100 by default, at most 500). */
  @Roles('owner', 'admin')
  @Get('audit')
  list(@Tenant() t: Membership, @Query() q: Record<string, string>) {
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    if (q.table && !(q.table in TABLE_LABEL)) throw new BadRequestException('Choose what to show');
    if ((q.from && !DATE.test(q.from)) || (q.to && !DATE.test(q.to))) throw new BadRequestException('Dates must be YYYY-MM-DD');
    if (q.before && !/^\d+$/.test(q.before)) throw new BadRequestException('Invalid page');
    return withTenant(this.pool, t.tenantId, async db => {
      const where: string[] = []; const params: unknown[] = [];
      const zone = (await db.query<{ timezone: string }>('select timezone from tenant_settings')).rows[0]?.timezone ?? 'Australia/Melbourne';
      if (q.table) { params.push(q.table); where.push(`table_name = $${params.length}`); }
      if (q.from) { params.push(q.from, zone); where.push(`at >= ($${params.length - 1}::date::timestamp at time zone $${params.length})`); }
      if (q.to) { params.push(q.to, zone); where.push(`at < (($${params.length - 1}::date + 1)::timestamp at time zone $${params.length})`); }
      return { ...(await page(db, where, params, limit, q.before)), tables: Object.entries(TABLE_LABEL).map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)) };
    });
  }

  /** Everything recorded about one person: their own record and anything that names them (credentials, shifts, leave…). */
  @Roles('owner', 'admin')
  @Get('workers/:id/audit')
  forWorker(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Query() q: Record<string, string>) {
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    if (q.before && !/^\d+$/.test(q.before)) throw new BadRequestException('Invalid page');
    return withTenant(this.pool, t.tenantId, db => page(db,
      ['worker_id = $1'], [id], limit, q.before));
  }
}
