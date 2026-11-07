import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { OFFICE_ROLES, type Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { wordsFor } from '../terms/words.js';
import { sortToCheck, toCheckItem, type ToCheckRow } from './to-check.js';

const LIMIT = 200;

/**
 * What's waiting for the office to check (backlog item 9a, the app's Requests tab): credentials not yet checked and
 * current right to work details not yet checked, for people who are active, applying or getting started. Office roles
 * see the list (supervisors never: credential files and right to work are office-only); owners and admins decide
 * through the existing verify and reject endpoints (`canDecide`).
 */
@ApiBearerAuth()
@Controller()
export class ToCheckController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get('to-check')
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => {
      const name = `coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name`;
      const credentials = (await db.query<ToCheckRow>(
        `select 'credential' as kind, c.id, w.id as "workerId", ${name} as "workerName", w.status::text as "workerStatus",
                ct.name as "typeName", ct.category::text as category, c.number, c.issued_by as "issuedBy",
                to_char(c.issue_date, 'YYYY-MM-DD') as "issueDate", to_char(c.expiry_date, 'YYYY-MM-DD') as "expiryDate",
                null as status, null as "vevoCheckedOn",
                (select e.details->>'via' from credential_events e where e.worker_credential_id = c.id and e.details ? 'via'
                  order by e.at desc limit 1) as via,
                coalesce((select max(d.uploaded_at) from credential_documents d where d.worker_credential_id = c.id and d.removed_at is null), c.created_at)::text as "sentAt",
                coalesce((select json_agg(json_build_object('id', d.id, 'filename', d.filename, 'contentType', d.content_type) order by d.uploaded_at)
                            from credential_documents d where d.worker_credential_id = c.id and d.removed_at is null), '[]') as files
           from worker_credentials c join workers w on w.id = c.worker_id join credential_types ct on ct.id = c.credential_type_id
          where c.verification = 'unverified' and w.status in ('active', 'onboarding', 'applicant')
          order by c.created_at limit ${LIMIT}`)).rows;
      const rightToWork = (await db.query<ToCheckRow>(
        `select 'right_to_work' as kind, r.id, w.id as "workerId", ${name} as "workerName", w.status::text as "workerStatus",
                null as "typeName", null as category, null as number, null as "issuedBy", null as "issueDate",
                to_char(r.visa_expiry, 'YYYY-MM-DD') as "expiryDate", r.status::text as status,
                to_char(r.vevo_checked_on, 'YYYY-MM-DD') as "vevoCheckedOn",
                (select e.details->>'via' from right_to_work_events e where e.record_id = r.id and e.details ? 'via'
                  order by e.at desc limit 1) as via,
                coalesce((select max(d.uploaded_at) from credential_documents d where d.right_to_work_id = r.id and d.removed_at is null), r.created_at)::text as "sentAt",
                coalesce((select json_agg(json_build_object('id', d.id, 'filename', d.filename, 'contentType', d.content_type) order by d.uploaded_at)
                            from credential_documents d where d.right_to_work_id = r.id and d.removed_at is null), '[]') as files
           from right_to_work_records r join workers w on w.id = r.worker_id
          where r.superseded_at is null and r.verification = 'unverified' and w.status in ('active', 'onboarding', 'applicant')
          order by r.created_at limit ${LIMIT}`)).rows;
      const w = await wordsFor(db);
      const items = sortToCheck([...credentials, ...rightToWork]).slice(0, LIMIT).map(r => toCheckItem(r, w));
      return { items, canDecide: t.role === 'owner' || t.role === 'admin' };
    });
  }
}
