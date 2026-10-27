import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { OFFICE_ROLES, type Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { attentionCounts, attentionItems, type AttentionShift } from './attention.js';
import { coverGapsBetween } from './cover-data.js';
import { eligibilityForShift } from './eligibility-data.js';
import { equipmentForShift } from './equipment-data.js';
import { SHIFT_COLS, SHIFT_FROM } from './roster.controller.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 14;
/** Enough for a busy fortnight at a few sites; beyond this the list says it was cut short. */
const MAX_SHIFTS = 400;

interface Row {
  id: string; startsAt: Date; equipmentOnly: boolean; workerId: string | null; workerName: string | null;
  assignmentStatus: 'assigned' | 'confirmed' | null; offersPending: number; offersExpired: number; pulledOutName: string | null;
  equipment: Array<{ id: string; name: string; typeName: string }>;
  facilityId: string; facilityName: string; areaName: string | null; role: string; localDate: string; localStart: string; localEnd: string;
  shiftLetter: string | null; status: string;
}

/** Needs attention (backlog item 12): shifts starting soon that the office should look at. */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class AttentionController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /**
   * Shifts starting in the next `days` (default 7, up to 14) at one site or all: nobody on them (and what's
   * been offered), people who haven't confirmed, people or equipment booked on them who can no longer
   * work them (a credential or a date run out, leave approved, out of service…), and gaps in cover rules
   * (`cover_gap`: someone working but nobody holding the credential the site needs). Most pressing first.
   */
  @Roles(...OFFICE_ROLES)
  @Get('roster/attention')
  attention(@Tenant() t: Membership, @Query() q: Record<string, string>) {
    const days = q.days === undefined || q.days === '' ? DEFAULT_DAYS : Number(q.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new BadRequestException(`Days must be a whole number from 1 to ${MAX_DAYS}`);
    if (q.facilityId && !UUID.test(q.facilityId)) throw new BadRequestException('Choose a site');
    const facilityId = q.facilityId || null;
    return withTenant(this.pool, t.tenantId, async db => {
      const now = (await db.query<{ now: Date }>('select now()')).rows[0].now;
      const rows = (await db.query<Row>(
        `select ${SHIFT_COLS},
                (select count(*)::int from shift_offers o where o.shift_id = s.id and o.status = 'pending'
                    and o.expires_at is not null and o.expires_at <= now()) as "offersExpired"
           from ${SHIFT_FROM}
          where s.status <> 'cancelled' and s.starts_at > now() and s.starts_at < now() + make_interval(days => $1)
            and ($2::uuid is null or s.facility_id = $2)
          order by s.starts_at, s.id limit ${MAX_SHIFTS + 1}`, [days, facilityId])).rows;
      const truncated = rows.length > MAX_SHIFTS;
      const list = rows.slice(0, MAX_SHIFTS);

      const facts: AttentionShift[] = [];
      for (const r of list) {
        let personBlocks: string[] = [];
        if (r.workerId) {
          const [c] = await eligibilityForShift(db, t.tenantId, r.id, [r.workerId]);
          personBlocks = c ? c.blocks.map(b => b.message) : [];
        }
        let equipmentBlocks: AttentionShift['equipmentBlocks'] = [];
        if (r.equipment.length) {
          equipmentBlocks = (await equipmentForShift(db, t.tenantId, r.id, r.equipment.map(e => e.id)))
            .filter(e => !e.eligible).map(e => ({ name: e.name, reasons: e.blocks.map(b => b.message) }));
        }
        facts.push({
          id: r.id, startsAt: r.startsAt, equipmentOnly: r.equipmentOnly, workerName: r.workerName, assignmentStatus: r.assignmentStatus,
          offersPending: r.offersPending, offersExpired: r.offersExpired, pulledOutName: r.pulledOutName,
          personBlocks, equipmentBlocks, equipmentMissing: r.equipmentOnly && !r.equipment.length,
        });
      }
      // Gaps in cover rules (migration 0030) over the same window, including one already under way.
      const until = new Date(now.getTime() + days * 86_400_000);
      const gaps = (await coverGapsBetween(db, now, until, facilityId)).filter(g => g.to > now && g.from < until);
      const byId = new Map(list.map(r => [r.id, r]));
      const missing = [...new Set(gaps.map(g => g.shiftId).filter(id => !byId.has(id)))];
      if (missing.length) {
        for (const r of (await db.query<Row>(`select ${SHIFT_COLS}, 0 as "offersExpired" from ${SHIFT_FROM} where s.id = any($1)`, [missing])).rows) byId.set(r.id, r);
      }
      const items = attentionItems(facts, now, undefined, gaps).map(i => {
        const r = byId.get(i.shiftId)!;
        return {
          ...i,
          shift: {
            id: r.id, facilityId: r.facilityId, facilityName: r.facilityName, areaName: r.areaName, role: r.role, localDate: r.localDate,
            localStart: r.localStart, localEnd: r.localEnd, shiftLetter: r.shiftLetter, status: r.status, workerName: r.workerName,
          },
        };
      });
      return { days, ...attentionCounts(items), truncated, items };
    });
  }
}
