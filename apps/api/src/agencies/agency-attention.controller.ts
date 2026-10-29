import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { OFFICE_ROLES, type Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { wordsFor } from '../terms/words.js';
import { peopleForRequest, INBOX_COLS, type InboxRow } from './agency-fill.controller.js';
import { agencyAttentionCounts, agencyAttentionItems, type AttentionPlacement, type AttentionRequest } from './attention.js';
import { localWhen } from './requests.js';

const DEFAULT_DAYS = 7;
const MAX_DAYS = 14;
/** Each request is checked against all the agency's people, so the list is capped; beyond this it says it was cut short. */
const MAX_ROWS = 100;

/**
 * Needs attention on the agency's side (backlog items 8 and 12). Reads only this business's own rows: its copies of
 * employers' requests, its offers, its people and its links. Nothing crosses to another business.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class AgencyAttentionController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /**
   * What in Allocations needs the office in the next `days` (default 7, up to 14): requests nobody has been put
   * forward for (what has been offered, how many of its people are ready), people it put forward who can no longer
   * work the shift by its own checks (credential or right to work run out, leave approved since, employment ended…),
   * people waiting for the employer's approval, and links waiting for it to match an employer's requirements.
   * Most pressing first.
   */
  @Roles(...OFFICE_ROLES)
  @Get('allocations/attention')
  attention(@Tenant() t: Membership, @Query('days') daysParam?: string) {
    const days = daysParam === undefined || daysParam === '' ? DEFAULT_DAYS : Number(daysParam);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new BadRequestException(`Days must be a whole number from 1 to ${MAX_DAYS}`);
    return withTenant(this.pool, t.tenantId, async db => {
      const now = (await db.query<{ now: Date }>('select now()')).rows[0].now;
      const rows = (await db.query<InboxRow & { offersPending: number; offersExpired: number }>(
        `select ${INBOX_COLS},
                (select count(*)::int from agency_offers o where o.inbox_id = agency_inbox.id and o.status = 'pending'
                    and (o.expires_at is null or o.expires_at > now())) as "offersPending",
                (select count(*)::int from agency_offers o where o.inbox_id = agency_inbox.id and o.status = 'pending'
                    and o.expires_at is not null and o.expires_at <= now()) as "offersExpired"
           from agency_inbox
          where starts_at > now() and starts_at < now() + make_interval(days => $1)
            and (status = 'open' or (placed_worker_id is not null and placement in ('waiting', 'booked')))
          order by starts_at, id limit ${MAX_ROWS + 1}`, [days])).rows;
      const truncated = rows.length > MAX_ROWS;
      const list = rows.slice(0, MAX_ROWS);

      const requests: AttentionRequest[] = [];
      const placements: AttentionPlacement[] = [];
      for (const r of list) {
        if (r.status === 'open' && !r.placedWorkerId) {
          const checked = await peopleForRequest(db, t.tenantId, r.id).catch(() => null);
          requests.push({
            id: r.id, startsAt: r.startsAt, employerName: r.employerName,
            ready: checked ? checked.people.filter(p => p.eligible).length : null,
            unmatchedMust: checked ? checked.unmatched.filter(u => u.severity === 'hard').length : 0,
            offersPending: r.offersPending, offersExpired: r.offersExpired,
          });
        } else if (r.placedWorkerId && (r.placement === 'waiting' || r.placement === 'booked')) {
          // The agency's own checks for the person it put forward, as when it put them forward (employer's requirements as matched, its own rules).
          const [p] = (await peopleForRequest(db, t.tenantId, r.id, [r.placedWorkerId], { evenIfClosed: true })).people;
          const blocks = p ? p.blocks.map(b => b.message) : [];
          const status = (await db.query<{ status: string }>('select status from workers where id = $1', [r.placedWorkerId])).rows[0]?.status;
          if (status !== 'active') blocks.unshift(`${r.placedName ?? 'This person'} is no longer active with you.`);
          placements.push({ id: r.id, startsAt: r.startsAt, employerName: r.employerName, personName: r.placedName ?? 'Someone', placement: r.placement, blocks });
        }
      }
      const links = (await db.query<{ connectionId: string; employerName: string }>(
        `select connection_id as "connectionId", other_name as "employerName" from agency_connections
          where side = 'agency' and status = 'matching' order by other_name`)).rows;

      const w = await wordsFor(db);
      const byId = new Map(list.map(r => [r.id, r]));
      const items = agencyAttentionItems(requests, placements, links, now, w).map(i => {
        const r = i.requestId ? byId.get(i.requestId) : undefined;
        return {
          ...i,
          request: r ? {
            id: r.id, employerName: r.employerName, siteName: r.siteName, areaName: r.areaName, role: r.role,
            startsAt: r.startsAt, when: localWhen(r), status: r.status, placedName: r.placedName,
          } : null,
        };
      });
      return { days, ...agencyAttentionCounts(items), truncated, items };
    });
  }
}
