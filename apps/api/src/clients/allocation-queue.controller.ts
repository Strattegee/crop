import { BadRequestException, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { UUID } from '../roster/shift-create.js';
import { fillWords, wordsFor } from '../terms/words.js';
import { myOffices } from '../facilities/offices.controller.js';
import { inOffice, officeChips, officeParam, parseOfficeFilter } from '../facilities/offices.js';
import { CHANNEL_WORDS, type Channel } from './client-orders.js';
import { loadSettings } from '../workforce/settings.js';
import { todayIn } from '../workforce/compliance.js';
import { CANCEL_KIND_WORDS, type CancelKind } from '../roster/cancel.js';
import {
  MAX_ROWS, PAGE_ROWS, QUEUE_BANDS, QUEUE_TABS, defaultTab, doneDays, doneOrder, initialsOf, isOutcome, onTab, parsePeriod, parseTab, progressLine,
  queueBand, queueOrder, queuePeriodDates, queueStage, type QueueBand, type QueueStage, type QueueTab,
} from './allocation-queue.js';

/** How long someone counts as "on" a shift after opening it. */
export const PRESENCE_MINUTES = 2;

type Raw = {
  id: string; facilityId: string; facilityName: string; region: string | null; officeId: string | null; officeName: string | null; areaName: string | null; role: string; status: string;
  startsAt: string; endsAt: string; localDate: string; localStart: string; localEnd: string; dayLabel: string; hours: number; breakMinutes: number;
  genderRequested: 'F' | 'M' | null; notes: string | null; timezone: string; siteToday: string; siteTomorrow: string;
  clientId: string; clientName: string; clientRank: number | null; clientConfirms: boolean;
  orderId: string | null; clientReference: string | null; orderChannel: Channel | null; requestedByName: string | null; orderNotes: string | null;
  workerId: string | null; workerName: string | null; assignmentStatus: string | null; assignedAt: string | null; clientConfirmedAt: string | null;
  offersTotal: number; offersPending: number; offersDeclined: number; acceptedAt: string | null; viaOffer: boolean;
  pulledOutName: string | null; pulledOutLocal: string | null; pulledOutAt: string | null; lastRemovedPulled: boolean;
  bookedAt: string | null; bookedToday: boolean; withAgencies: boolean; waitingSince: string;
  ended: boolean; cancelKind: CancelKind | null; cancelledReason: string | null;
  presence: { userId: string; name: string }[];
};

const whole = (v: string | undefined, def: number, min: number, max: number) => {
  const n = v === undefined || v === '' ? def : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadRequestException(`Choose ${min} to ${max} days`);
  return n;
};

/**
 * The allocation queue (David chose layout A, 2 Nov 2026): client shifts still needing work, most urgent first, with
 * tab and office (region) counts, for the Allocations screen. One query set, scoped to the business by RLS.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class AllocationQueueController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /**
   * `stage` = a tab (all, new, released, accepted, worker_to_confirm, client_to_confirm, pulled_out, booked_today; with
   * a calendar period also done, worked, unfilled, cancelled),
   * `office` = all | mine | none | an office id (migration 0077; left out = the caller's offices when they have any),
   * `region` = the site's state, `clientId`, `days` (1–14, default 3; started shifts that haven't ended are always in).
   * `period` = week | month | prev_month (David, 4 Nov) instead of `days`: every client shift whose local start date
   * is in the current week (Monday–Sunday), current month or previous month in the business's dates, including ended
   * and cancelled ones with their outcome as the stage; rows come `limit` at a time (default PAGE_ROWS) with `more`.
   * Tab counts take the office, region and client filters; office and region chip counts take the client filter only.
   * `offices` (chips, the caller's first) is empty when the business has no offices: the web then shows state chips.
   */
  @Roles(...OFFICE_ROLES)
  @Get('allocations/queue')
  queue(@Tenant() t: Membership, @Auth() auth: AuthContext, @Query('stage') stageQ?: string, @Query('region') regionQ?: string,
    @Query('clientId') clientQ?: string, @Query('days') daysQ?: string, @Query('office') officeQ?: string,
    @Query('period') periodQ?: string, @Query('limit') limitQ?: string) {
    const period = parsePeriod(periodQ);
    if (periodQ && !period) throw new BadRequestException('Choose the current week, the current month or the previous month');
    const days = period ? null : whole(daysQ, 3, 1, 14);
    const limit = period ? Math.min(MAX_ROWS, Math.max(1, Math.floor(Number(limitQ)) || PAGE_ROWS)) : null;
    const tab = parseTab(stageQ, period);
    const region = regionQ?.trim() ? regionQ.trim().slice(0, 60) : null;
    const clientId = clientQ && UUID.test(clientQ) ? clientQ : null;
    return withTenant(this.pool, t.tenantId, async db => {
      const mine = await myOffices(db, auth.userId);
      const office = parseOfficeFilter(officeQ, mine.size > 0);
      const officeList = (await db.query<{ id: string; name: string; active: boolean }>('select id, name, active from offices')).rows;
      const today = period ? todayIn((await loadSettings(db, t.tenantId)).timezone) : null;
      const range = period && today ? queuePeriodDates(period, today) : null;
      // Forward-looking: shifts still to come or under way, not cancelled. Calendar: every shift starting on a local
      // date in the period (the UTC bounds with two days' slack let the (tenant_id, starts_at) index do the work).
      const window = range
        ? `$1::int is null and s.starts_at >= ($4::date - 2)::timestamp at time zone 'UTC' and s.starts_at < ($5::date + 3)::timestamp at time zone 'UTC'
           and (s.starts_at at time zone f.timezone)::date between $4::date and $5::date`
        : `s.status <> 'cancelled' and s.ends_at > now() and s.starts_at < now() + make_interval(days => $1)`;
      const raw = (await db.query<Raw>(
        `select s.id, s.facility_id as "facilityId", f.name as "facilityName", nullif(trim(f.state), '') as region,
                f.office_id as "officeId", ofc.name as "officeName", a.name as "areaName",
                s.role, s.status::text as status, s.starts_at as "startsAt", s.ends_at as "endsAt", f.timezone,
                to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as "localDate",
                to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "localStart",
                to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "localEnd",
                to_char(s.starts_at at time zone f.timezone, 'Dy') as "dayLabel",
                round((extract(epoch from (s.ends_at - s.starts_at)) / 3600 - s.break_minutes / 60.0)::numeric, 2)::float8 as hours,
                s.break_minutes as "breakMinutes", s.gender_requested as "genderRequested", s.notes,
                to_char(now() at time zone f.timezone, 'YYYY-MM-DD') as "siteToday",
                to_char((now() at time zone f.timezone) + interval '1 day', 'YYYY-MM-DD') as "siteTomorrow",
                c.id as "clientId", c.name as "clientName", c.rank as "clientRank", c.confirms_bookings as "clientConfirms",
                o.id as "orderId", o.client_reference as "clientReference", o.channel as "orderChannel", o.requested_by_name as "requestedByName",
                o.notes as "orderNotes",
                sa.worker_id as "workerId",
                case when w.id is null then null else coalesce(nullif(trim(w.preferred_name), ''), w.first_name) || ' ' || w.last_name end as "workerName",
                sa.status::text as "assignmentStatus", sa.created_at as "assignedAt",
                case when sa.worker_id is not null and s.client_confirmed_worker_id = sa.worker_id then s.client_confirmed_at end as "clientConfirmedAt",
                coalesce(ofs.total, 0) as "offersTotal", coalesce(ofs.pending, 0) as "offersPending", coalesce(ofs.declined, 0) as "offersDeclined",
                to_char(coalesce(acc.responded_at, sa.created_at) at time zone f.timezone, 'HH24:MI') as "acceptedAt", acc.responded_at is not null as "viaOffer",
                rm.name as "pulledOutName", to_char(rm.ended_at at time zone f.timezone, 'HH24:MI') as "pulledOutLocal", rm.ended_at as "pulledOutAt",
                coalesce(rm.pulled, false) as "lastRemovedPulled",
                bk.at as "bookedAt",
                coalesce(to_char(greatest(bk.at, case when s.client_confirmed_worker_id = sa.worker_id then s.client_confirmed_at end) at time zone f.timezone, 'YYYY-MM-DD')
                         = to_char(now() at time zone f.timezone, 'YYYY-MM-DD'), false) as "bookedToday",
                exists (select 1 from agency_requests ar where ar.shift_id = s.id and ar.status = 'open') as "withAgencies",
                greatest(coalesce(o.created_at, s.created_at), case when rm.pulled then rm.ended_at end) as "waitingSince",
                s.ends_at <= now() as ended, s.cancel_kind as "cancelKind", s.cancelled_reason as "cancelledReason",
                coalesce((select json_agg(json_build_object('userId', p.user_id, 'name', p.name) order by p.seen_at desc)
                            from allocation_presence p where p.shift_id = s.id and p.seen_at > now() - make_interval(mins => $3)), '[]'::json) as presence
           from shifts s join facilities f on f.id = s.facility_id join clients c on c.id = f.client_id
           left join offices ofc on ofc.id = f.office_id
           left join areas a on a.id = s.area_id left join client_orders o on o.id = s.client_order_id
           left join shift_assignments sa on sa.shift_id = s.id and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed')
           left join workers w on w.id = sa.worker_id
           left join lateral (
             select count(*)::int as total,
                    count(*) filter (where x.status = 'pending' and (x.expires_at is null or x.expires_at > now()))::int as pending,
                    count(*) filter (where x.status = 'declined')::int as declined
               from shift_offers x where x.shift_id = s.id) ofs on true
           left join lateral (
             select x.responded_at from shift_offers x where x.shift_id = s.id and x.worker_id = sa.worker_id and x.status = 'accepted'
              order by x.responded_at desc limit 1) acc on true
           left join lateral (
             select coalesce(nullif(trim(pw.preferred_name), ''), pw.first_name) || ' ' || pw.last_name as name, px.ended_at,
                    px.removed_reason = 'pulled_out' as pulled
               from shift_assignments px join workers pw on pw.id = px.worker_id
              where px.shift_id = s.id and px.resource_kind = 'worker' and px.status = 'removed'
              order by px.ended_at desc nulls last limit 1) rm on true
           left join lateral (
             select max(ch.at) as at from shift_changes ch where ch.shift_id = s.id and ch.kind in ('booked', 'confirmed') and ch.worker_id = sa.worker_id) bk on true
          where s.needs_person and ${window}
            and ($2::uuid is null or c.id = $2)
          limit ${range ? 20000 : 2000}`, range ? [null, clientId, PRESENCE_MINUTES, range.from, range.to] : [days, clientId, PRESENCE_MINUTES])).rows;

      const w = await wordsFor(db);
      const now = new Date();
      const rows = raw.map(r => {
        const stage: QueueStage = queueStage({ status: r.status, offersPending: r.offersPending, pulledOut: r.lastRemovedPulled && !r.workerId,
          clientConfirms: r.clientConfirms, clientConfirmedAt: r.clientConfirmedAt, ended: r.ended });
        const pulled = stage === 'pulled_out' || stage === 'not_refilled';
        const cancelWords = stage === 'cancelled' ? fillWords(CANCEL_KIND_WORDS[r.cancelKind ?? 'other'], w) : null;
        const others = r.presence.filter(p => p.userId !== auth.userId);
        return {
          id: r.id, facilityId: r.facilityId, facilityName: r.facilityName, region: r.region, officeId: r.officeId, officeName: r.officeName, areaName: r.areaName, role: r.role, status: r.status,
          startsAt: r.startsAt, endsAt: r.endsAt, timezone: r.timezone, localDate: r.localDate, localStart: r.localStart, localEnd: r.localEnd,
          dayLabel: r.dayLabel, hours: r.hours, breakMinutes: r.breakMinutes, genderRequested: r.genderRequested, notes: r.notes,
          clientId: r.clientId, clientName: r.clientName, clientRank: r.clientRank, clientConfirms: r.clientConfirms,
          orderId: r.orderId, clientReference: r.clientReference, orderChannel: r.orderChannel,
          channelWords: r.orderChannel ? CHANNEL_WORDS[r.orderChannel] : null, requestedByName: r.requestedByName, orderNotes: r.orderNotes,
          workerId: r.workerId, workerName: r.workerName, clientConfirmedAt: r.clientConfirmedAt,
          offersTotal: r.offersTotal, offersPending: r.offersPending, offersDeclined: r.offersDeclined,
          pulledOutName: pulled ? r.pulledOutName : null, pulledOutAt: pulled ? r.pulledOutAt : null,
          withAgencies: r.withAgencies, waitingSince: isOutcome(stage) ? null : r.waitingSince, bookedAt: r.bookedAt, bookedToday: stage === 'booked' && r.bookedToday,
          ended: r.ended, cancelKind: stage === 'cancelled' ? (r.cancelKind ?? 'other') : null, cancelWords,
          stage, band: queueBand({ ...r, stage }, now, r.siteToday, r.siteTomorrow),
          progress: progressLine({ stage, workerName: r.workerName, offersTotal: r.offersTotal, offersPending: r.offersPending, offersDeclined: r.offersDeclined,
            acceptedAt: r.workerId ? r.acceptedAt : null, viaOffer: r.viaOffer, pulledOutName: r.pulledOutName, pulledOutAt: r.pulledOutLocal,
            withAgencies: r.withAgencies, cancelWords, cancelReason: stage === 'cancelled' ? r.cancelledReason : null }, w),
          presence: others.map(p => ({ name: p.name, initials: initialsOf(p.name) })),
          youAreOn: r.presence.length > others.length,
        };
      }).sort((a, b) => (a.band === 'done') !== (b.band === 'done') ? (a.band === 'done' ? 1 : -1) : a.band === 'done' ? doneOrder(a, b) : queueOrder(a, b));

      const counted = (r: (typeof rows)[number], k: QueueTab) => onTab(k, r.stage, r.bookedToday);
      // Chips count what the period is mostly about: still needing someone, or (previous month) what happened.
      const chipTab = defaultTab(period);
      const inClient = rows;
      const inOffices = inClient.filter(r => inOffice(office, r.officeId, mine));
      const inRegion = region ? inOffices.filter(r => r.region === region) : inOffices;
      const counts = Object.fromEntries(QUEUE_TABS.map(k => [k, inRegion.filter(r => counted(r, k)).length])) as Record<QueueTab, number>;
      const regionNames = [...new Set(inClient.map(r => r.region).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b));
      const regions = regionNames.map(name => ({ name, count: inClient.filter(r => r.region === name && counted(r, chipTab)).length }));
      const shown = inRegion.filter(r => counted(r, tab));
      const bands = Object.fromEntries(QUEUE_BANDS.map(b => [b, shown.filter(r => r.band === b).length])) as Record<QueueBand, number>;
      const needing = inClient.filter(r => counted(r, chipTab));
      const chips = officeList.length ? officeChips(officeList, needing, mine) : { offices: [], noOffice: 0 };
      const page = limit === null ? shown : shown.slice(0, limit);
      return {
        tab, region, clientId, days, period, from: range?.from ?? null, to: range?.to ?? null, today,
        office: officeParam(office), myOffices: [...mine], offices: chips.offices, noOffice: chips.noOffice,
        counts, regions, bands, doneDays: doneDays(shown), total: shown.length, more: shown.length - page.length, shifts: page,
      };
    });
  }

  /**
   * Records that the signed-in office person has this shift's fill panel open (they show as "on" it for
   * PRESENCE_MINUTES). Never a lock. Clears rows older than a day while it's here.
   */
  @Roles(...OFFICE_ROLES)
  @Post('allocations/presence/:shiftId')
  @HttpCode(204)
  async presence(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('shiftId', ParseUUIDPipe) shiftId: string) {
    const name = (auth.displayName || auth.email || 'Someone').slice(0, 200);
    await withTenant(this.pool, t.tenantId, async db => {
      await db.query(
        `insert into allocation_presence(tenant_id, shift_id, user_id, name)
         select $1, s.id, $3, $4 from shifts s where s.id = $2
         on conflict (shift_id, user_id) do update set seen_at = now(), name = excluded.name`, [t.tenantId, shiftId, auth.userId, name]);
      await db.query(`delete from allocation_presence where seen_at < now() - interval '1 day'`);
    });
  }
}
