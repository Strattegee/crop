import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { wordsFor } from '../terms/words.js';
import { actorOf } from './publishing.js';
import { loadSwap, makeSwap, SWAP_SELECT, swapMode, tellBoth, viewOf, type SwapRow } from './swaps-data.js';
import { decideRefusal, swapStateLine, swapSummary } from './swaps.js';

const DECIDERS = new Set(['owner', 'admin']);
const STATUSES = ['open', 'agreed', 'all'] as const;

function officeView(r: SwapRow, role: string | null) {
  return {
    id: r.id, status: r.status, shiftId: r.shiftId, otherShiftId: r.otherShiftId,
    fromWorkerId: r.fromWorkerId, fromName: r.fromName, toWorkerId: r.toWorkerId, toName: r.toName,
    shift: r.shift, other: r.other, summary: swapSummary(viewOf(r)),
    // From the asker's side, which reads naturally for the office too ("Waiting for their answer").
    stateLine: swapStateLine(r.status, true), reason: r.reason,
    createdAt: r.createdAt, answeredAt: r.answeredAt, decidedAt: r.decidedAt, decidedByName: r.decidedByName,
    canDecide: r.status === 'agreed' && DECIDERS.has(role ?? ''),
  };
}

/**
 * Shift swaps from the office's side (migration 0073): the list, and owners and admins approving or not approving a
 * swap both people have agreed (when the business's setting is `approve`). Approving makes it through the ordinary
 * assign rules with the approver as the actor; if anything stops it, nothing changes.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('shift-swaps')
export class SwapsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** `status=open` (default: waiting for a colleague or the office), `agreed` (waiting for the office) or `all` (last 30 days). */
  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Query('status') status?: string) {
    const s = (status ?? 'open') as typeof STATUSES[number];
    if (!STATUSES.includes(s)) throw new BadRequestException('Choose open, agreed or all');
    return withTenant(this.pool, t.tenantId, async db => {
      const where = s === 'open' ? `sw.status in ('asked', 'agreed')` : s === 'agreed' ? `sw.status = 'agreed'`
        : `(sw.status in ('asked', 'agreed') or sw.updated_at > now() - interval '30 days')`;
      const rows = (await db.query<SwapRow>(`${SWAP_SELECT} where ${where} order by s.starts_at limit 200`)).rows;
      return { mode: await swapMode(db, t.tenantId), swaps: rows.map(r => officeView(r, t.role)) };
    });
  }

  @Roles('owner', 'admin')
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const actor = actorOf(auth);
    return withTenant(this.pool, t.tenantId, async db => {
      const sw = await loadSwap(db, id, true);
      const refusal = decideRefusal(sw.status);
      if (refusal) throw new ConflictException(refusal);
      await makeSwap(db, t.tenantId, auth.userId, sw);
      await db.query(
        `update shift_swaps set status = 'done', decided_at = now(), decided_by = $2, decided_by_name = $3, updated_at = now() where id = $1`,
        [id, auth.userId, actor.name]);
      const done = await loadSwap(db, id);
      await tellBoth(db, t.tenantId, done, 'done', auth.userId, await wordsFor(db));
      return officeView(done, t.role);
    }, actor);
  }

  /** Not approved: both people stay on their own shifts and are emailed. `reason` is kept for the office only. */
  @Roles('owner', 'admin')
  @Post(':id/refuse')
  @HttpCode(200)
  refuse(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const reason = text(body ?? {}, 'reason', { max: 300 });
    const actor = actorOf(auth);
    return withTenant(this.pool, t.tenantId, async db => {
      const sw = await loadSwap(db, id, true);
      const refusal = decideRefusal(sw.status);
      if (refusal) throw new ConflictException(refusal);
      await db.query(
        `update shift_swaps set status = 'refused', reason = $4, decided_at = now(), decided_by = $2, decided_by_name = $3, updated_at = now() where id = $1`,
        [id, auth.userId, actor.name, reason]);
      const r = await loadSwap(db, id);
      await tellBoth(db, t.tenantId, r, 'refused', auth.userId, await wordsFor(db));
      return officeView(r, t.role);
    }, actor);
  }
}
