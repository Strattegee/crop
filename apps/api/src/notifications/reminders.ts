import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { APP_POOL } from '../database/database.module.js';
import { addDays, todayIn } from '../workforce/compliance.js';
import { loadSettings } from '../workforce/settings.js';
import { queueNotification } from './notify.js';

const WORKER_STAGES = [7, 30, 60]; // days before expiry
const OFFICE_STAGE = 30;
const SEND_FROM_HOUR = 8; // don't message people before 8am agency time

interface Expiring {
  key: string; // what the reminder is about, for de-duplication
  workerId: string;
  firstName: string;
  workerName: string;
  email: string | null;
  phone: string | null;
  what: string; // e.g. "CPR", "visa", "a vaccination record"
  expiry: string; // YYYY-MM-DD
}

/** A piece of equipment's date (registration, service, inspection…) coming due. */
interface EquipmentDue {
  key: string;
  label: string; // "Forklift 2 (FL-02)"
  what: string; // "Registration"
  due: string; // YYYY-MM-DD
  /** Shifts it is booked on, from now, whose local date is after the due date (it can't be used on them). */
  bookedAfter: number;
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function longDate(iso: string) {
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

/**
 * Expiry reminders (spec CRD-7), checked hourly and sent from 8am agency time:
 * - Workers: at 60, 30 and 7 days before a credential or visa expires (7 days: email and text).
 * - Office (owners and admins): one daily email listing what reaches 30 days and what expired, for people
 *   and for equipment dates (registration, service, inspection…), with how many shifts a machine is booked on
 *   after its date runs out.
 * Each reminder has a de-duplication key, so running more often never sends twice.
 * Messages carry no health information or document numbers (vaccinations are "a vaccination record").
 */
@Injectable()
export class ExpiryReminders implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Reminders');
  private timer?: NodeJS.Timeout;

  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  onApplicationBootstrap() {
    if (process.env.NOTIFY_DISPATCH === 'off') return;
    const run = () => void this.runOnce().catch(err => this.log.error(err));
    setTimeout(run, 60_000).unref();
    this.timer = setInterval(run, 60 * 60_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Checks every agency. `now` is for tests. Returns how many messages were queued. */
  async runOnce(now = new Date()): Promise<number> {
    const tenants = (await this.pool.query<{ id: string; name: string }>('select id, name from tenants')).rows;
    let queued = 0;
    for (const t of tenants) queued += await withTenant(this.pool, t.id, db => this.forAgency(db, t.id, t.name, now));
    return queued;
  }

  private async forAgency(db: PoolClient, tenantId: string, agency: string, now: Date): Promise<number> {
    const settings = await loadSettings(db, tenantId);
    const hour = Number(new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hourCycle: 'h23', timeZone: settings.timezone }).format(now));
    if (hour < SEND_FROM_HOUR) return 0;
    const today = todayIn(settings.timezone, now);
    const horizon = addDays(today, Math.max(...WORKER_STAGES));
    const items = await this.expiring(db, today, horizon);
    let queued = 0;
    const q = async (n: Parameters<typeof queueNotification>[2]) => {
      const r = await queueNotification(db, tenantId, n);
      if (r.status !== 'duplicate') queued++;
    };

    for (const it of items) {
      const days = daysBetween(today, it.expiry);
      if (days < 0) continue; // already expired: the office hears about it, not repeated nagging
      const stage = WORKER_STAGES.find(s => days <= s);
      if (!stage) continue;
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `on ${longDate(it.expiry)}`;
      const text = `Hi ${it.firstName}, your ${it.what} expires ${when}. Please send your renewal to ${agency} so you can keep being booked for shifts.`;
      if (it.email) {
        await q({ channel: 'email', to: it.email, template: 'credential_expiry', workerId: it.workerId, dedupeKey: `${it.key}:${stage}:email`,
          subject: `Your ${it.what} expires ${when}`, body: `${text}\n\nThanks,\n${agency}` });
      }
      if (stage === 7 && it.phone) {
        await q({ channel: 'sms', to: it.phone, template: 'credential_expiry', workerId: it.workerId, dedupeKey: `${it.key}:${stage}:sms`, body: text });
      }
    }

    // Office digest: items reaching 30 days today or earlier (not yet reported), and items that have expired.
    const lines: string[] = [];
    const keys: string[] = [];
    for (const it of items) {
      const days = daysBetween(today, it.expiry);
      if (days < 0 || days > OFFICE_STAGE) continue;
      const stage = days === 0 ? 'expires today' : `expires ${longDate(it.expiry)} (${days} days)`;
      const k = `${it.key}:office:${days === 0 ? 'expiry' : OFFICE_STAGE}`;
      if (await marked(db, k)) continue;
      lines.push(`- ${it.workerName}: ${it.what} ${stage}`);
      keys.push(k);
    }
    // Expired in the last week (a week, so a missed day isn't missed for good).
    const expired = await this.expiring(db, addDays(today, -7), addDays(today, -1));
    for (const it of expired) {
      const k = `${it.key}:office:expired`;
      if (await marked(db, k)) continue;
      lines.push(`- ${it.workerName}: ${it.what} expired ${longDate(it.expiry)}`);
      keys.push(k);
    }

    // Equipment dates: the same stages as people (30 days, due day, overdue in the last week).
    const equipLines: string[] = [];
    const booked = (e: EquipmentDue) => e.bookedAfter ? `; booked on ${e.bookedAfter} shift${e.bookedAfter === 1 ? '' : 's'} after that date` : '';
    for (const e of await this.equipmentDue(db, today, addDays(today, -7), addDays(today, OFFICE_STAGE))) {
      const days = daysBetween(today, e.due);
      const k = `${e.key}:office:${days < 0 ? 'expired' : days === 0 ? 'expiry' : OFFICE_STAGE}`;
      if (await marked(db, k)) continue;
      const stage = days < 0 ? `was due ${longDate(e.due)} (overdue)` : days === 0 ? 'is due today' : `is due ${longDate(e.due)} (${days} days)`;
      equipLines.push(`- ${e.label}: ${e.what} ${stage}${booked(e)}`);
      keys.push(k);
    }

    const total = lines.length + equipLines.length;
    if (total) {
      const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');
      const sections: string[] = [];
      if (lines.length) {
        sections.push(`${equipLines.length ? 'People:\n' : ''}${lines.join('\n')}\n\n${appUrl ? `See the compliance page: ${appUrl}/compliance` : 'See the Compliance page in CROP.'}`);
      }
      if (equipLines.length) {
        sections.push(`Equipment:\n${equipLines.join('\n')}\n\nRecord the new date against the equipment in CROP once it's done.`);
      }
      const body = `These need attention at ${agency}:\n\n${sections.join('\n\n')}`;
      const offices = (await db.query<{ email: string }>('select email from app_agency_office_emails()')).rows;
      for (const o of offices) {
        await q({ channel: 'email', to: o.email, template: 'compliance_expiry', dedupeKey: `office-digest:${today}:${o.email}`,
          subject: `Compliance: ${total} ${total === 1 ? 'date' : 'dates'} to follow up`, body });
      }
      // Mark each item as reported, so the next digest only has what's new.
      for (const k of keys) {
        await db.query('insert into reminder_marks(tenant_id, mark) values ($1, $2) on conflict do nothing', [tenantId, k]);
      }
    }
    return queued;
  }

  /** Current, non-rejected credentials and visas of active workers expiring between two dates (inclusive). */
  private async expiring(db: PoolClient, from: string, to: string): Promise<Expiring[]> {
    const creds = (await db.query<Expiring & { category: string; type_name: string }>(
      `select c.id, w.id as "workerId", coalesce(w.preferred_name, w.first_name) as "firstName", w.first_name || ' ' || w.last_name as "workerName",
              w.email, w.phone, t.name as type_name, t.category, to_char(c.expiry_date, 'YYYY-MM-DD') as expiry, 'cred:' || c.id as key
         from worker_credentials c join workers w on w.id = c.worker_id join credential_types t on t.id = c.credential_type_id
        where w.status = 'active' and t.active and c.verification <> 'rejected' and c.expiry_date between $1::date and $2::date
          -- skip if it has already been renewed (another credential of the same type expires later)
          and not exists (select 1 from worker_credentials n where n.worker_id = c.worker_id and n.credential_type_id = c.credential_type_id
                            and n.id <> c.id and n.verification <> 'rejected' and n.expiry_date > c.expiry_date)`,
      [from, to],
    )).rows.map(r => ({ ...r, what: r.category === 'vaccination' ? 'vaccination record' : r.type_name }));
    const visas = (await db.query<Expiring>(
      `select w.id as "workerId", coalesce(w.preferred_name, w.first_name) as "firstName", w.first_name || ' ' || w.last_name as "workerName",
              w.email, w.phone, 'visa' as what, to_char(r.visa_expiry, 'YYYY-MM-DD') as expiry, 'visa:' || r.id as key
         from right_to_work_records r join workers w on w.id = r.worker_id
        where w.status = 'active' and r.superseded_at is null and r.status = 'visa_holder' and r.verification <> 'rejected'
          and r.visa_expiry between $1::date and $2::date`,
      [from, to],
    )).rows;
    return [...creds, ...visas];
  }

  /**
   * Current dates of equipment still in use (not retired) falling between two dates (inclusive), with how many
   * upcoming bookings fall after the date on the shift site's local calendar (so the office knows to act).
   */
  private async equipmentDue(db: PoolClient, today: string, from: string, to: string): Promise<EquipmentDue[]> {
    return (await db.query<EquipmentDue>(
      `select 'equip:' || c.id as key, e.name || coalesce(' (' || e.asset_number || ')', '') as label, c.name as what,
              to_char(c.due_on, 'YYYY-MM-DD') as due,
              (select count(*)::int from shift_assignments a join shifts s on s.id = a.shift_id join facilities f on f.id = s.facility_id
                where a.equipment_id = e.id and a.resource_kind = 'equipment' and a.status in ('assigned', 'confirmed')
                  and s.status <> 'cancelled' and (s.starts_at at time zone f.timezone)::date > c.due_on
                  and (s.starts_at at time zone f.timezone)::date >= $1::date) as "bookedAfter"
         from equipment_checks c join equipment e on e.id = c.equipment_id
        where c.superseded_at is null and e.status <> 'retired' and c.due_on between $2::date and $3::date
        order by c.due_on, e.name`,
      [today, from, to],
    )).rows;
  }
}

async function marked(db: PoolClient, mark: string): Promise<boolean> {
  return Boolean((await db.query('select 1 from reminder_marks where mark = $1', [mark])).rowCount);
}
