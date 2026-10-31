import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, oneOf } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { AttentionController } from '../roster/attention.controller.js';
import { DEFAULT_WORDS, T, wordsFor } from '../terms/words.js';
import { funnel, history, MEASURES, saveSnapshot, targetsOf } from './dashboard-data.js';
import { loadSettings } from '../workforce/settings.js';
import { todayIn } from '../workforce/compliance.js';
import {
  defaultFocus, FOCUS_LABEL, FOCUSES, kpiByKey, KPIS, kpisFor, seesCosts, SETTING_KPIS, standing, targetRefusal, tidy, trendDays, worded, type Focus,
} from './kpis.js';

type TeamRow = { user_id: string; name: string; email: string; role: string; focus: Focus | null; sees_costs: boolean };

/**
 * Dashboards (David, 31 Oct): one per job focus, chosen for each office person by the owner; the business's own
 * targets for the numbers. Strategy doc: https://claude.ai/artifact/8HsDrtMtQXr4KFAAwXRbof
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class DashboardController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /**
   * The caller's dashboard: their focus (set by the owner, else the default for their role) and its numbers, each
   * with the business's target and whether it is on target. `?focus=` shows another focus's dashboard.
   */
  @Roles(...OFFICE_ROLES)
  @Get('dashboard')
  async dashboard(@Tenant() t: Membership, @Auth() auth: AuthContext, @Query('focus') wanted?: string) {
    if (wanted && !(FOCUSES as readonly string[]).includes(wanted)) throw new BadRequestException('Choose a dashboard');
    const blocked = async () => {
      const a = await new AttentionController(this.pool).attention(t, { days: '7' }) as { byKind: Record<string, number> };
      return a.byKind?.person_blocked ?? 0;
    };
    return withTenant(this.pool, t.tenantId, async db => {
      const mine = (await db.query<{ focus: Focus | null; sees_costs: boolean }>(
        'select focus, sees_costs from member_focus where user_id = $1', [auth.userId])).rows[0];
      const assigned = mine?.focus ?? defaultFocus(t.role);
      const focus = (wanted as Focus | undefined) ?? assigned;
      const targets = await targetsOf(db);
      const w = await wordsFor(db);
      const say = (x: string) => worded(x, w, T);
      const today = todayIn((await loadSettings(db, t.tenantId)).timezone);
      const days = trendDays(today);
      const kpis = [];
      for (const def of kpisFor(focus)) {
        const m = await MEASURES[def.key](db, { tenantId: t.tenantId, targets, blockedShifts: blocked });
        const value = tidy(m.value, def.unit);
        const target = targets.get(def.key) ?? null;
        kpis.push({
          key: def.key, label: say(def.label), question: say(def.question), how: say(def.how), unit: def.unit, better: def.better, href: def.href,
          value, detail: m.detail ?? null, breakdown: m.breakdown ?? [], target, suggested: def.suggested,
          standing: standing(value, target, def.better),
        });
        await saveSnapshot(db, t.tenantId, today, def.key, value);
      }
      // Each number with its value a week ago and its 13-week trend (today's value last).
      const past = await history(db, kpis.map(k => k.key), days);
      const withHistory = kpis.map(k => {
        const trend = past.get(k.key)!;
        return { ...k, weekAgo: trend[trend.length - 2] ?? null, trend };
      });
      return {
        focus, label: FOCUS_LABEL[focus], assigned, assignedByOwner: !!mine?.focus,
        seesCosts: seesCosts(t.role, mine?.sees_costs ?? false),
        focuses: FOCUSES.map(f => ({ focus: f, label: FOCUS_LABEL[f] })),
        kpis: withHistory,
        funnel: focus === 'recruitment' ? await funnel(db) : null,
      };
    });
  }

  /** The business's targets, with CROP's suggestion for each (owners and admins set them). */
  @Roles(...OFFICE_ROLES)
  @Get('dashboard/targets')
  targets(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => {
      const set = await targetsOf(db);
      const w = await wordsFor(db);
      return KPIS.map(k => ({
        key: k.key, focus: k.focus, label: worded(k.label, w, T), how: worded(k.how, w, T), unit: k.unit, better: k.better, suggested: k.suggested,
        target: set.get(k.key) ?? null, setting: SETTING_KPIS.has(k.key),
      }));
    });
  }

  /** `{ targets: [{ key, value|null }] }`: null clears a target (the number is then shown without a mark). */
  @Roles('owner', 'admin')
  @Put('dashboard/targets')
  @HttpCode(200)
  setTargets(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const list = body.targets;
    if (!Array.isArray(list) || list.length === 0 || list.length > KPIS.length) throw new BadRequestException('Send the targets to change');
    const changes = list.map(raw => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const def = typeof r.key === 'string' ? kpiByKey(r.key) : null;
      if (!def) throw new BadRequestException('Unknown measure');
      if (r.value === null || r.value === '' || r.value === undefined) return { key: def.key, value: null };
      const value = typeof r.value === 'number' ? r.value : Number(r.value);
      const refusal = targetRefusal(def, value);
      if (refusal) throw new BadRequestException(`${worded(def.label, DEFAULT_WORDS, T)}: ${refusal}`);
      return { key: def.key, value };
    });
    return withTenant(this.pool, t.tenantId, async db => {
      for (const c of changes) {
        if (c.value === null) await db.query('delete from dashboard_targets where kpi = $1', [c.key]);
        else await db.query(
          `insert into dashboard_targets(tenant_id, kpi, value, set_by) values ($1,$2,$3,$4)
           on conflict (tenant_id, kpi) do update set value = excluded.value, set_by = excluded.set_by, set_at = now()`,
          [t.tenantId, c.key, c.value, auth.userId]);
      }
      return { saved: changes.length };
    });
  }

  /** The office people and their dashboards (owner only: David, 31 Oct). */
  @Roles('owner')
  @Get('team')
  team(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query<TeamRow>('select * from app_office_team()')).rows.map(r => ({
      userId: r.user_id, name: r.name, email: r.email, role: r.role,
      focus: r.focus, effectiveFocus: r.focus ?? defaultFocus(r.role), seesCosts: seesCosts(r.role, r.sees_costs), costsGranted: r.sees_costs,
    })));
  }

  /** `{ focus: allocator|compliance|recruitment|overview|null, seesCosts?: boolean }` for one office person (owner only). */
  @Roles('owner')
  @Put('team/:userId')
  @HttpCode(200)
  setFocus(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('userId', ParseUUIDPipe) userId: string, @Body() body: Record<string, unknown>) {
    const focus = body.focus === null ? null : oneOf(body, 'focus', FOCUSES);
    if (focus === null && body.focus !== null && body.focus !== undefined) throw new BadRequestException('Choose a dashboard');
    const costs = bool(body, 'seesCosts');
    return withTenant(this.pool, t.tenantId, async db => {
      const member = (await db.query<TeamRow>('select * from app_office_team() where user_id = $1', [userId])).rows[0];
      if (!member) throw new NotFoundException('Person not found in your office');
      const current = (await db.query<{ focus: Focus | null; sees_costs: boolean }>('select focus, sees_costs from member_focus where user_id = $1', [userId])).rows[0];
      const nextFocus = body.focus === undefined ? current?.focus ?? null : focus;
      const nextCosts = costs ?? current?.sees_costs ?? false;
      await db.query(
        `insert into member_focus(tenant_id, user_id, focus, sees_costs, set_by) values ($1,$2,$3,$4,$5)
         on conflict (tenant_id, user_id) do update set focus = excluded.focus, sees_costs = excluded.sees_costs, set_by = excluded.set_by, set_at = now()`,
        [t.tenantId, userId, nextFocus, nextCosts, auth.userId]);
      return { userId, focus: nextFocus, effectiveFocus: nextFocus ?? defaultFocus(member.role), seesCosts: seesCosts(member.role, nextCosts), costsGranted: nextCosts };
    });
  }
}
