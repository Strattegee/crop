import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import type { AuthContext, Membership } from '../auth/auth.types.js';
import { Auth, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { queueNotification, queuePush } from '../notifications/notify.js';
import { eligibilityForShift } from '../roster/eligibility-data.js';
import { rosterChangeRefusal } from '../roster/offers-data.js';
import { loadSwap, makeSwap, shiftFacts, SWAP_SELECT, swapMode, swapProblem, tellBoth, viewOf, type SwapRow } from '../roster/swaps-data.js';
import {
  answerRefusal, askRefusal, swapAskedEmail, swapDeclinedEmail, swapStateLine, swapSummary, swapToApproveEmail, withdrawRefusal,
} from '../roster/swaps.js';
import { fillWords, T, wordsFor } from '../terms/words.js';
import { requireLinked } from './worker-app.controller.js';
import { tellOffice } from './tell-office.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How far ahead the app looks for colleagues' shifts to swap for. */
export const SWAP_LOOKAHEAD_DAYS = 28;
/** At most this many of a colleague's shifts are checked for a swap (the eligibility check runs for each). */
export const SWAP_OPTION_LIMIT = 40;

/** A swap from one person's side: their own view, never anything about the colleague beyond name and the shifts. */
function mineView(r: SwapRow, me: string) {
  const mine = r.fromWorkerId === me;
  return {
    id: r.id, status: r.status, mine,
    colleague: mine ? r.toName : r.fromName,
    shift: r.shift, other: r.other,
    line: swapSummary(viewOf(r)),
    stateLine: swapStateLine(r.status, mine),
    canAnswer: !mine && r.status === 'asked',
    canWithdraw: mine && (r.status === 'asked' || r.status === 'agreed'),
    createdAt: r.createdAt,
  };
}

/**
 * Shift swaps in the worker app (migration 0073; Steve's answer 5): the person asks a colleague with the app to take
 * one of their shifts or to swap it for one of the colleague's; the colleague says yes or no here; then, by the
 * business's setting, it is made at once or waits for an owner or admin (swaps.controller.ts).
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('my/swaps')
export class MySwapsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  private async me(t: Membership, auth: AuthContext) {
    return withTenant(this.pool, t.tenantId, db => requireLinked(db, auth));
  }

  private run<R>(t: Membership, auth: AuthContext, w: { id: string; name: string }, fn: (db: PoolClient) => Promise<R>) {
    return withTenant(this.pool, t.tenantId, fn, { id: auth.userId, name: w.name, via: 'app', role: t.role });
  }

  /** The person's swaps: open ones, and those closed in the last 14 days. `mode` says whether swapping is on. */
  @Get()
  list(@Tenant() t: Membership, @Auth() auth: AuthContext) {
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      const rows = (await db.query<SwapRow>(
        `${SWAP_SELECT} where (sw.from_worker_id = $1 or sw.to_worker_id = $1)
           and (sw.status in ('asked', 'agreed') or sw.updated_at > now() - interval '14 days')
         order by (sw.status in ('asked', 'agreed')) desc, s.starts_at`, [w.id])).rows;
      return { mode: await swapMode(db, t.tenantId), swaps: rows.map(r => mineView(r, w.id)) };
    });
  }

  /**
   * Who the person could ask about one of their shifts: colleagues with the app who can work it (to hand it over),
   * and colleagues' shifts at the same site in the next four weeks that the person can work and whose colleague can
   * work theirs (to swap). Only people who pass every rule are listed, with no reasons, so nothing about anyone's
   * records shows.
   */
  @Get('options')
  options(@Tenant() t: Membership, @Auth() auth: AuthContext, @Query('shiftId') shiftId?: string) {
    if (!shiftId || !UUID.test(shiftId)) throw new BadRequestException('Choose {a shift}');
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      const words = await wordsFor(db);
      const mode = await swapMode(db, t.tenantId);
      const f = await shiftFacts(db, shiftId, w.id);
      if (!f?.onShift) throw new ForbiddenException('You aren\'t on this {shift}');
      const refusal = askRefusal({ mode, ...f, openSwap: false, colleagueActive: true }, words);
      if (refusal) throw new ConflictException(refusal);
      const colleagues = (await db.query<{ id: string; name: string }>(
        `select id, coalesce(preferred_name, first_name) || ' ' || last_name as name from workers
          where status = 'active' and user_id is not null and id <> $1 order by lower(coalesce(preferred_name, first_name)), lower(last_name)`,
        [w.id])).rows;
      if (!colleagues.length) return { mode, takers: [], swaps: [] };
      const forMine = await eligibilityForShift(db, t.tenantId, shiftId, colleagues.map(c => c.id));
      const canTakeMine = new Set(forMine.filter(c => c.eligible).map(c => c.workerId));
      // Colleagues' shifts at the same site, published, not started, that someone who could take mine is on.
      const theirs = (await db.query<{ shiftId: string; workerId: string; localDate: string; localStart: string; localEnd: string; role: string; site: string; area: string | null }>(
        `select s.id as "shiftId", sa.worker_id as "workerId", s.role, f.name as site, a.name as area,
                to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as "localDate",
                to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "localStart",
                to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "localEnd"
           from shifts s join facilities f on f.id = s.facility_id left join areas a on a.id = s.area_id
           join shift_assignments sa on sa.shift_id = s.id and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed')
          where s.facility_id = $1 and s.id <> $2 and s.status <> 'cancelled' and s.starts_at > now()
            and s.starts_at < now() + make_interval(days => $3) and sa.worker_id = any($4::uuid[])
            and exists (select 1 from roster_publications p where p.facility_id = s.facility_id
                         and p.week_start = date_trunc('week', s.starts_at at time zone f.timezone)::date)
            and not exists (select 1 from shift_swaps o where o.shift_id = s.id and o.status in ('asked', 'agreed'))
          order by s.starts_at limit $5`,
        [f.facilityId, shiftId, SWAP_LOOKAHEAD_DAYS, [...canTakeMine], SWAP_OPTION_LIMIT])).rows;
      const names = new Map(colleagues.map(c => [c.id, c.name]));
      const swaps = [];
      for (const s of theirs) {
        const [me] = await eligibilityForShift(db, t.tenantId, s.shiftId, [w.id]);
        // A clash with my own shift isn't a real clash when the two are swapped, so it's left to the try at asking.
        if (me && me.blocks.every(b => b.code === 'double_booked')) {
          swaps.push({ shiftId: s.shiftId, workerId: s.workerId, name: names.get(s.workerId)!, shift: s });
        }
      }
      return {
        mode,
        takers: colleagues.filter(c => canTakeMine.has(c.id)).map(c => ({ workerId: c.id, name: c.name })),
        swaps,
      };
    });
  }

  /** Asks a colleague: `{shiftId, workerId}` to hand the shift over, plus `otherShiftId` to swap for theirs. */
  @Post()
  async ask(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const shiftId = body?.shiftId, workerId = body?.workerId, otherShiftId = body?.otherShiftId ?? null;
    if (typeof shiftId !== 'string' || !UUID.test(shiftId)) throw new BadRequestException('Choose {a shift}');
    if (typeof workerId !== 'string' || !UUID.test(workerId)) throw new BadRequestException('Choose someone to swap with');
    if (otherShiftId !== null && (typeof otherShiftId !== 'string' || !UUID.test(otherShiftId))) throw new BadRequestException('Choose {a shift} to swap for');
    const w = await this.me(t, auth);
    return this.run(t, auth, w, async db => {
      const words = await wordsFor(db);
      const mode = await swapMode(db, t.tenantId);
      await db.query('select 1 from shifts where id = $1 for update', [shiftId]);
      const f = await shiftFacts(db, shiftId, w.id);
      if (!f) throw new BadRequestException('Choose {a shift}');
      const colleague = (await db.query<{ ok: boolean }>(
        `select status = 'active' and user_id is not null as ok from workers where id = $1 and id <> $2`, [workerId, w.id])).rows[0];
      const o = otherShiftId ? await shiftFacts(db, otherShiftId, workerId) : null;
      if (otherShiftId && !o) throw new BadRequestException('Choose {a shift} to swap for');
      const openSwap = !!(await db.query(`select 1 from shift_swaps where shift_id = $1 and status in ('asked', 'agreed')`, [shiftId])).rowCount;
      const refusal = askRefusal({
        mode, ...f, openSwap, colleagueActive: !!colleague?.ok,
        other: o ? { colleagueOnIt: o.onShift, started: o.started, cancelled: o.cancelled, published: o.published, sameShift: otherShiftId === shiftId } : null,
      }, words);
      if (refusal) throw new ConflictException(refusal);
      if (o && o.facilityId !== f.facilityId) throw new ConflictException('Choose {a shift} at the same {site}');
      for (const id of [shiftId, otherShiftId]) {
        if (!id) continue;
        const locked = await rosterChangeRefusal(db, id);
        if (locked) throw new ConflictException(locked);
      }
      const id = (await db.query<{ id: string }>(
        `insert into shift_swaps(tenant_id, shift_id, from_worker_id, to_worker_id, other_shift_id, created_by)
         values ($1, $2, $3, $4, $5, $6) returning id`, [t.tenantId, shiftId, w.id, workerId, otherShiftId, auth.userId])).rows[0].id;
      const sw = await loadSwap(db, id);
      // Tried now and undone, so nobody is asked about a swap the rules would stop.
      const problem = await swapProblem(db, t.tenantId, sw);
      if (problem) throw new ConflictException(fillWords(problem, words));
      const m = swapAskedEmail({ ...viewOf(sw), toFirstName: sw.toFirstName, business: t.tenantName }, words);
      if (sw.toEmail) {
        await queueNotification(db, t.tenantId, {
          channel: 'email', to: sw.toEmail, template: 'shift_swap_asked', subject: m.subject, body: m.body,
          workerId: sw.toWorkerId, createdBy: auth.userId, dedupeKey: `swap:${id}:asked`,
        });
      }
      await queuePush(db, t.tenantId, { workerId: sw.toWorkerId, template: 'shift_swap_asked', ...m.push, createdBy: auth.userId, dedupeKey: `swap:${id}:asked` });
      return mineView(sw, w.id);
    });
  }

  /** The colleague says yes: made at once (automatic) or waiting for an owner or admin (approve). */
  @Post(':id/accept')
  @HttpCode(200)
  async accept(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const w = await this.me(t, auth);
    return this.run(t, auth, w, async db => {
      const words = await wordsFor(db);
      const sw = await this.forColleague(db, id, w.id);
      const refusal = answerRefusal(sw.status);
      if (refusal) throw new ConflictException(refusal);
      const mode = await swapMode(db, t.tenantId);
      if (mode === 'off') throw new ConflictException(`Swapping ${words.lower(T.shift, true)} isn't turned on here. Contact the office.`);
      if (mode === 'automatic') {
        await makeSwap(db, t.tenantId, auth.userId, sw);
        await db.query(`update shift_swaps set status = 'done', answered_at = now(), decided_at = now(), updated_at = now() where id = $1`, [id]);
        const done = await loadSwap(db, id);
        await tellBoth(db, t.tenantId, done, 'done', auth.userId, words);
        return mineView(done, w.id);
      }
      const problem = await swapProblem(db, t.tenantId, sw);
      if (problem) throw new ConflictException(fillWords(problem, words));
      await db.query(`update shift_swaps set status = 'agreed', answered_at = now(), updated_at = now() where id = $1`, [id]);
      const agreed = await loadSwap(db, id);
      const m = swapToApproveEmail(viewOf(agreed), process.env.APP_URL ?? '', words);
      await tellOffice(db, t.tenantId, { ...m, template: 'shift_swap_to_approve', dedupeKey: `swap:${id}:agreed`, createdBy: auth.userId, exceptEmail: auth.email });
      return mineView(agreed, w.id);
    });
  }

  /** The colleague says no; the asker is emailed and stays on their shift. */
  @Post(':id/decline')
  @HttpCode(200)
  async decline(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const w = await this.me(t, auth);
    return this.run(t, auth, w, async db => {
      const words = await wordsFor(db);
      const sw = await this.forColleague(db, id, w.id);
      const refusal = answerRefusal(sw.status);
      if (refusal) throw new ConflictException(refusal);
      await db.query(`update shift_swaps set status = 'declined', answered_at = now(), updated_at = now() where id = $1`, [id]);
      const r = await loadSwap(db, id);
      const m = swapDeclinedEmail({ ...viewOf(r), fromFirstName: r.fromFirstName }, words);
      if (r.fromEmail) {
        await queueNotification(db, t.tenantId, {
          channel: 'email', to: r.fromEmail, template: 'shift_swap_declined', subject: m.subject, body: m.body,
          workerId: r.fromWorkerId, createdBy: auth.userId, dedupeKey: `swap:${id}:declined`,
        });
      }
      await queuePush(db, t.tenantId, { workerId: r.fromWorkerId, template: 'shift_swap_declined', ...m.push, createdBy: auth.userId, dedupeKey: `swap:${id}:declined` });
      return mineView(r, w.id);
    });
  }

  /** The asker takes it back while it is still open. */
  @Post(':id/withdraw')
  @HttpCode(200)
  async withdraw(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const w = await this.me(t, auth);
    return this.run(t, auth, w, async db => {
      const sw = await loadSwap(db, id, true);
      if (sw.fromWorkerId !== w.id) throw new ForbiddenException('Only the person who asked can take it back');
      const refusal = withdrawRefusal(sw.status);
      if (refusal) throw new ConflictException(refusal);
      await db.query(`update shift_swaps set status = 'withdrawn', updated_at = now() where id = $1`, [id]);
      return mineView(await loadSwap(db, id), w.id);
    });
  }

  private async forColleague(db: PoolClient, id: string, me: string): Promise<SwapRow> {
    const sw = await loadSwap(db, id, true);
    if (sw.toWorkerId !== me) throw new ForbiddenException('Only the person asked can answer');
    return sw;
  }
}

