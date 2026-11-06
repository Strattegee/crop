import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { APP_POOL } from '../database/database.module.js';
import { loadSettings } from '../workforce/settings.js';
import { wordsFor } from '../terms/words.js';
import { queueNotification } from './notify.js';
import { pushText } from './push.js';
import {
  ALERT_DEFAULTS, AT_RISK_MINUTES, atRiskKind, atRiskPush, planAlert, seesSite,
  type AlertKind, type AlertSettings, type AtRiskShift,
} from './manager-alerts.js';

/** One phone of an office person, with their alert choices. */
export interface OfficePhone {
  userId: string;
  role: string;
  /** Sites they are limited to (supervisors, limited allocators); empty for everyone else. */
  sites: string[];
  deviceId: string;
  token: string;
  settings: AlertSettings;
}

/** An office person's own choices, or CROP's defaults when they haven't chosen. */
export async function alertSettingsOf(db: PoolClient, userId: string): Promise<AlertSettings> {
  const r = (await db.query<{ decisions: boolean; atRisk: boolean; quietFrom: string | null; quietUntil: string | null }>(
    `select decisions, at_risk as "atRisk", to_char(quiet_from, 'HH24:MI') as "quietFrom", to_char(quiet_until, 'HH24:MI') as "quietUntil"
       from member_alerts where user_id = $1`, [userId])).rows[0];
  return r ?? { ...ALERT_DEFAULTS };
}

/** Every live phone of the business's office people (owners, admins, allocators, supervisors). */
export async function officePhones(db: PoolClient): Promise<OfficePhone[]> {
  const rows = (await db.query<{ userId: string; role: string; sites: string[]; deviceId: string; token: string; chosen: boolean;
    decisions: boolean | null; atRisk: boolean | null; quietFrom: string | null; quietUntil: string | null }>(
    `select o.user_id as "userId", o.role::text as role,
            coalesce((select array_agg(ms.facility_id::text) from member_sites ms where ms.user_id = o.user_id), '{}') as sites,
            d.id as "deviceId", d.token, a.user_id is not null as chosen, a.decisions, a.at_risk as "atRisk",
            to_char(a.quiet_from, 'HH24:MI') as "quietFrom", to_char(a.quiet_until, 'HH24:MI') as "quietUntil"
       from app_office_team() o
       join push_devices d on d.user_id = o.user_id and d.removed_at is null
       left join member_alerts a on a.user_id = o.user_id
      order by d.created_at`)).rows;
  return rows.map(r => ({
    userId: r.userId, role: r.role, sites: r.sites, deviceId: r.deviceId, token: r.token,
    settings: r.chosen ? { decisions: !!r.decisions, atRisk: !!r.atRisk, quietFrom: r.quietFrom, quietUntil: r.quietUntil } : { ...ALERT_DEFAULTS },
  }));
}

export interface OfficeAlert {
  kind: AlertKind;
  /** Owners and admins only (decisions they make); otherwise everyone in the office who sees the site. */
  deciders?: boolean;
  facilityId: string | null;
  template: string;
  title: string;
  body: string;
  /** One alert per phone, never twice (the phone's id is added). */
  dedupeKey: string;
  /** The person who caused it (not told about their own request). */
  exceptUserId?: string | null;
  /** Held until quiet hours end (true), or not sent during them (false: the caller tries again later). */
  holdThroughQuiet: boolean;
  createdBy?: string | null;
  now?: Date;
}

/**
 * Queues a push alert to the office people's phones (inside withTenant), following each person's choices and quiet
 * hours in the business's time zone. Nobody with the app = nothing queued. Returns how many were queued.
 */
export async function alertOffice(db: PoolClient, tenantId: string, a: OfficeAlert, phones?: OfficePhone[], zone?: string): Promise<number> {
  const list = phones ?? await officePhones(db);
  if (!list.length) return 0;
  const tz = zone ?? (await loadSettings(db, tenantId)).timezone;
  const now = a.now ?? new Date();
  const t = pushText(a.title, a.body);
  let n = 0;
  for (const p of list) {
    if (a.exceptUserId && p.userId === a.exceptUserId) continue;
    if (a.deciders ? p.role !== 'owner' && p.role !== 'admin' : !seesSite(p, a.facilityId)) continue;
    const plan = planAlert(a.kind, p.settings, now, tz, a.holdThroughQuiet);
    if (!plan.send) continue;
    const r = await queueNotification(db, tenantId, {
      channel: 'push', to: p.token, template: a.template, subject: t.title, body: t.body,
      dedupeKey: `${a.dedupeKey}:office:${p.deviceId}`, createdBy: a.createdBy ?? null, notBefore: plan.notBefore,
    });
    if (r.status !== 'duplicate') n++;
  }
  return n;
}

/** The templates of office alerts (the app opens its manager side for them). */
export const OFFICE_ALERT_TEMPLATES = {
  atRisk: 'office_shift_at_risk',
  pulledOut: 'office_pulled_out',
  leave: 'office_leave_to_approve',
  changeRequest: 'office_change_to_approve',
} as const;

/**
 * Shifts starting soon that still need someone (backlog item 9a): every 5 minutes, for each business with an office
 * phone, shifts needing a person that start within `AT_RISK_MINUTES` with nobody on them, someone not confirmed, or an
 * agency's person waiting for approval go to the phones of the office people who see that site. Once per shift and
 * reason; nothing during someone's quiet hours (the next check after they end sends it if it still matters).
 * Off with NOTIFY_DISPATCH=off or MANAGER_ALERTS=off; tests call `runOnce()`.
 */
@Injectable()
export class ManagerAlerts implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('ManagerAlerts');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  onApplicationBootstrap() {
    if (process.env.NOTIFY_DISPATCH === 'off' || process.env.MANAGER_ALERTS === 'off') return;
    this.timer = setInterval(() => void this.runOnce().catch(err => this.log.error(err)), 5 * 60_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Checks every business. `now` is for tests. Returns how many alerts were queued. */
  async runOnce(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const tenants = (await this.pool.query<{ id: string }>('select id from tenants')).rows;
      let queued = 0;
      for (const t of tenants) queued += await withTenant(this.pool, t.id, db => this.forBusiness(db, t.id, now));
      return queued;
    } finally {
      this.running = false;
    }
  }

  private async forBusiness(db: PoolClient, tenantId: string, now: Date): Promise<number> {
    const phones = (await officePhones(db)).filter(p => p.settings.atRisk);
    if (!phones.length) return 0;
    const shifts = (await db.query<AtRiskShift & { id: string; facilityId: string; startsAt: Date }>(
      `select s.id, s.facility_id as "facilityId", f.name as "facilityName", a.name as "areaName", s.role, s.starts_at as "startsAt",
              to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "localStart", to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "localEnd",
              sa.status as "assignmentStatus", w.agency_name as "agencyName",
              case when w.id is null then null else coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name end as "workerName"
         from shifts s join facilities f on f.id = s.facility_id left join areas a on a.id = s.area_id
         left join shift_assignments sa on sa.shift_id = s.id and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed')
         left join workers w on w.id = sa.worker_id
        where s.status <> 'cancelled' and s.needs_person and s.starts_at > $1 and s.starts_at <= $1::timestamptz + make_interval(mins => $2)
        order by s.starts_at`, [now, AT_RISK_MINUTES])).rows;
    if (!shifts.length) return 0;
    const zone = (await loadSettings(db, tenantId)).timezone;
    const words = await wordsFor(db);
    let queued = 0;
    for (const s of shifts) {
      const kind = atRiskKind(s);
      if (!kind) continue;
      const m = atRiskPush(kind, s, (s.startsAt.getTime() - now.getTime()) / 60_000, words);
      queued += await alertOffice(db, tenantId, {
        kind: 'at_risk', facilityId: s.facilityId, template: OFFICE_ALERT_TEMPLATES.atRisk, ...m,
        dedupeKey: `at-risk:${s.id}:${kind}`, holdThroughQuiet: false, now,
      }, phones, zone);
    }
    return queued;
  }
}
