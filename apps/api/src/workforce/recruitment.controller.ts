import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { complianceContext, credentialFactsByWorker, rightToWorkByWorker } from './compliance-data.js';
import { cardsFor } from './person-card.js';
import { onboardingProgress } from './onboarding.controller.js';
import { BOARD_STAGES, daysSince, MOVES, moveRefusal, STAGE_LABEL, STARTED_DAYS, type BoardStage } from './recruitment.js';

const nameOf = (auth: AuthContext | null) => (auth ? auth.displayName || auth.email : null);

/** Logs a move on the recruitment board (within withTenant). */
export async function recruitmentEvent(
  db: PoolClient, tenantId: string, workerId: string, auth: AuthContext | null, to: string, from: string | null, note: string | null = null,
) {
  await db.query(
    `insert into recruitment_events(tenant_id, worker_id, actor_user_id, actor_name, to_stage, from_stage, note) values ($1,$2,$3,$4,$5,$6,$7)`,
    [tenantId, workerId, auth?.userId ?? null, nameOf(auth), to, from, note]);
}

const PERSON_COLS = `w.id, w.first_name as "firstName", w.last_name as "lastName", w.preferred_name as "preferredName", w.email, w.phone,
  w.status, w.roles, w.gender, w.recruitment_stage as "stage", w.stage_changed_at as "stageChangedAt"`;

/** The recruitment board: applicants by stage, people being onboarded, and people who started recently. */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class RecruitmentController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get('recruitment')
  board(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => {
      type P = { id: string; status: string; roles: string[]; stage: string | null; stageChangedAt: Date | null };
      const applicants = (await db.query<P>(`select ${PERSON_COLS} from workers w where w.status = 'applicant' order by w.stage_changed_at nulls first, w.last_name`)).rows;
      const onboarding = (await db.query<P & { onboardingId: string; startedAt: Date }>(
        `select ${PERSON_COLS}, o.id as "onboardingId", o.started_at as "startedAt"
           from workers w join worker_onboardings o on o.worker_id = w.id and o.finished_at is null
          where w.status = 'onboarding' order by o.started_at`)).rows;
      const started = (await db.query<P & { finishedAt: Date }>(
        `select ${PERSON_COLS}, o.finished_at as "finishedAt"
           from workers w join worker_onboardings o on o.worker_id = w.id and o.outcome = 'completed'
          where w.status = 'active' and o.finished_at > now() - make_interval(days => $1)
            and exists (select 1 from recruitment_events e where e.worker_id = w.id)
          order by o.finished_at desc`, [STARTED_DAYS])).rows;
      const all = [...applicants, ...onboarding, ...started];
      const ids = all.map(p => p.id);
      const ctx = await complianceContext(db, t.tenantId);
      const facts = await credentialFactsByWorker(db, ids);
      const rtw = await rightToWorkByWorker(db, ids);
      const cards = await cardsFor(db, ids, ctx.today);
      // Onboarding progress (required steps done of total), as on the person's page.
      const progress = new Map<string, { done: number; total: number; ready: boolean }>();
      for (const p of onboarding) {
        const sm = (await onboardingProgress(db, t.tenantId, p.onboardingId)).summary as { done: number; total: number; ready: boolean };
        progress.set(p.id, { done: sm.done, total: sm.total, ready: sm.ready });
      }
      const person = (p: P, extra: object = {}) => {
        const c = ctx.evaluate(p.roles, facts.get(p.id) ?? [], rtw.get(p.id) ?? null);
        return {
          ...p, compliance: c.status, card: cards.get(p.id),
          mustHavesToDo: c.issues.filter(i => i.severity === 'hard' && i.problem !== 'expiring').length,
          ...extra,
        };
      };
      const columns = [
        ...BOARD_STAGES.map(stage => ({
          stage, label: STAGE_LABEL[stage],
          people: applicants.filter(p => (p.stage ?? 'applied') === stage).map(p => person(p, { days: daysSince(p.stageChangedAt) })),
        })),
        { stage: 'onboarding', label: STAGE_LABEL.onboarding,
          people: onboarding.map(p => person(p, { days: daysSince(p.startedAt), onboardingId: p.onboardingId, progress: progress.get(p.id) })) },
        { stage: 'started', label: STAGE_LABEL.started, people: started.map(p => person(p, { days: daysSince(p.finishedAt) })) },
      ];
      const notProceeding = (await db.query<{ n: number }>(
        `select count(distinct e.worker_id)::int as n from recruitment_events e join workers w on w.id = e.worker_id
          where e.to_stage = 'not_proceeding' and e.at > now() - make_interval(days => $1) and w.status = 'inactive'`, [STARTED_DAYS])).rows[0].n;
      return { columns, notProceeding, today: ctx.today };
    });
  }

  /** People marked not proceeding (newest first), so they can be reopened. */
  @Roles(...OFFICE_ROLES)
  @Get('recruitment/not-proceeding')
  notProceeding(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query(
      `select ${PERSON_COLS}, e.at, e.note, e.actor_name as "byName"
         from workers w join lateral (select * from recruitment_events x where x.worker_id = w.id order by x.at desc limit 1) e on true
        where w.status = 'inactive' and e.to_stage = 'not_proceeding' order by e.at desc limit 200`)).rows);
  }

  /**
   * Moves an applicant: `{ stage: applied|screening|interview|offer|not_proceeding|reopen, note? }`. Starting onboarding
   * is done with the onboarding endpoint (it moves them to Onboarding).
   */
  @Roles(...OFFICE_ROLES)
  @Post('workers/:id/stage')
  @HttpCode(200)
  move(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const to = oneOf(body, 'stage', MOVES, { required: true })!;
    const note = text(body, 'note', { max: 500 });
    return withTenant(this.pool, t.tenantId, async db => {
      const p = (await db.query<{ status: string; stage: string | null }>(
        'select status, recruitment_stage as stage from workers where id = $1 for update', [id])).rows[0];
      if (!p || p.status === 'agency') throw new NotFoundException('Person not found');
      const lastEvent = (await db.query<{ to_stage: string }>(
        'select to_stage from recruitment_events where worker_id = $1 order by at desc limit 1', [id])).rows[0]?.to_stage ?? null;
      const refusal = moveRefusal({ ...p, lastEvent }, to);
      if (refusal) throw new ConflictException(refusal);
      if (to === 'not_proceeding') {
        await db.query(`update workers set status = 'inactive', updated_at = now() where id = $1`, [id]);
        await recruitmentEvent(db, t.tenantId, id, auth, 'not_proceeding', p.stage, note);
      } else if (to === 'reopen') {
        await db.query(`update workers set status = 'applicant', recruitment_stage = coalesce(recruitment_stage, 'applied'), stage_changed_at = now(), updated_at = now() where id = $1`, [id]);
        await recruitmentEvent(db, t.tenantId, id, auth, 'reopened', null, note);
      } else {
        await db.query('update workers set recruitment_stage = $2, stage_changed_at = now(), updated_at = now() where id = $1', [id, to as BoardStage]);
        await recruitmentEvent(db, t.tenantId, id, auth, to, p.stage, note);
      }
      return (await db.query(`select ${PERSON_COLS} from workers w where w.id = $1`, [id])).rows[0];
    });
  }

  /** The person's moves, oldest first (their page). */
  @Roles(...OFFICE_ROLES)
  @Get('workers/:id/recruitment')
  history(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query(
      `select at, to_stage as "toStage", from_stage as "fromStage", actor_name as "byName", note from recruitment_events where worker_id = $1 order by at`, [id])).rows);
  }
}
