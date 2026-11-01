import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { actorOf } from '../roster/publishing.js';
import { complianceContext, credentialFactsByWorker, rightToWorkByWorker } from '../workforce/compliance-data.js';
import { EMPLOYED_ON } from '../roster/eligibility-data.js';
import { agencySitesWords, rolesChoice, rolesWords, sitesChoice, sitesWords } from './requests.js';
import { T, wordsFor, type Words } from '../terms/words.js';
import { groupSummary, personReadiness, rankReadiness, readinessGroups, type RequirementLevel } from './readiness.js';
import { hashInviteToken, INVITE_DAYS, INVITE_TOKEN, inviteState, inviteUrl, linkStatusWords, matchesProblem, newInviteLink, orderProblem, type LinkStatus } from './links.js';

const NOT_VALID = "This link isn't valid. Check you've used the whole link.";

type LinkRow = {
  connectionId: string; side: 'employer' | 'agency'; otherName: string; status: LinkStatus; preference: number | null;
  bookMode: 'automatic' | 'approve_first'; createdAt: Date; endedAt: Date | null; endedByName: string | null;
  endedBySide: 'employer' | 'agency' | null; endReason: string | null;
  /** Employer side: the sites this agency fills (null = every site), with their names. */
  facilityIds: string[] | null; siteNames: string[] | null;
  /** Employer side: the roles this agency fills (null = every role). Agency side: filled in from the employer's choice. */
  roles: string[] | null;
};
const LINK_COLS = `connection_id as "connectionId", side, other_name as "otherName", status, preference, book_mode as "bookMode",
  created_at as "createdAt", ended_at as "endedAt", ended_by_name as "endedByName", ended_by_side as "endedBySide", end_reason as "endReason",
  facility_ids as "facilityIds", roles,
  case when facility_ids is null then null else
    coalesce((select array_agg(f.name order by f.name) from facilities f where f.id = any(facility_ids)), '{}') end as "siteNames"`;

/**
 * Which sites the link covers, in words. Employer side: from its own row. Agency side (live links): the employer's
 * sites it fills, by name, through the checked `app_agency_link_sites` (migration 0064); `siteNames` lists them.
 */
async function siteFacts(db: PoolClient, r: LinkRow, w: Words): Promise<{ siteNames: string[] | null; sitesWords: string | null }> {
  if (r.side === 'employer') return { siteNames: r.siteNames, sitesWords: sitesWords(r.siteNames, w) };
  if (r.status === 'ended') return { siteNames: null, sitesWords: null };
  const rows = (await db.query<{ site_name: string; every_site: boolean }>('select * from app_agency_link_sites($1)', [r.connectionId])).rows;
  const names = rows.map(x => x.site_name);
  return { siteNames: names, sitesWords: agencySitesWords(names, rows[0]?.every_site ?? true, w) };
}

/**
 * Which roles the link covers. Employer side: its own row. Agency side (live links): the roles the employer chose,
 * through the checked `app_agency_link_roles` (migration 0065), or every role.
 */
async function roleFacts(db: PoolClient, r: LinkRow, w: Words): Promise<{ roles: string[] | null; rolesWords: string | null }> {
  if (r.side === 'employer') return { roles: r.roles, rolesWords: rolesWords(r.roles, w) };
  if (r.status === 'ended') return { roles: null, rolesWords: null };
  const roles = (await db.query<{ roles: string[] | null }>('select app_agency_link_roles($1) as roles', [r.connectionId])).rows[0].roles;
  return { roles, rolesWords: rolesWords(roles, w) };
}

/** The business's role names: its role list and roles its own people have (as `GET /roles`). */
async function knownRoles(db: PoolClient): Promise<string[]> {
  return (await db.query<{ name: string }>(
    `select name from business_roles
     union
     select x.role from workers w, unnest(w.roles) as x(role) where w.status = 'active' and w.agency_connection_id is null
     order by 1`)).rows.map(r => r.name);
}

async function linkById(db: PoolClient, connectionId: string, w?: Words) {
  const row = (await db.query<LinkRow>(`select ${LINK_COLS} from agency_connections where connection_id = $1`, [connectionId])).rows[0];
  if (!row) throw new NotFoundException('Link not found');
  const words = w ?? await wordsFor(db);
  return { ...row, statusWords: linkStatusWords(row.status, row.side, row.otherName), ...await siteFacts(db, row, words), ...await roleFacts(db, row, words) };
}

type Requirement = {
  requirementId: string; name: string; catalogueCode: string | null; category: string; hasExpiry: boolean;
  severity: 'hard' | 'warning' | 'optional'; neededFor: string[];
  match: { credentialTypeId: string; name: string; matchedBy: 'code' | 'hand'; matchedByName: string | null; matchedAt: Date } | null;
  suggestion: { credentialTypeId: string; name: string } | null;
};

/** The employer's requirements (through the checked function) joined with this agency's matches and suggestions. */
async function requirementsFor(db: PoolClient, connectionId: string): Promise<Requirement[]> {
  const rows = (await db.query<{ requirement_id: string; name: string; catalogue_code: string | null; category: string; has_expiry: boolean; severity: Requirement['severity']; needed_for: string[] }>(
    'select * from app_agency_requirements($1)', [connectionId])).rows;
  const maps = new Map((await db.query<{ employer_credential_type_id: string; credential_type_id: string; name: string; active: boolean; matched_by: 'code' | 'hand'; matched_by_name: string | null; matched_at: Date }>(
    `select m.employer_credential_type_id, m.credential_type_id, ct.name, ct.active, m.matched_by, m.matched_by_name, m.matched_at
       from agency_credential_maps m join credential_types ct on ct.id = m.credential_type_id where m.connection_id = $1`, [connectionId])).rows
    .filter(m => m.active).map(m => [m.employer_credential_type_id, m]));
  const byCode = new Map((await db.query<{ id: string; name: string; catalogue_code: string }>(
    'select id, name, catalogue_code from credential_types where active and catalogue_code is not null')).rows.map(c => [c.catalogue_code, c]));
  return rows.map(r => {
    const m = maps.get(r.requirement_id);
    const s = r.catalogue_code ? byCode.get(r.catalogue_code) : undefined;
    return {
      requirementId: r.requirement_id, name: r.name, catalogueCode: r.catalogue_code, category: r.category, hasExpiry: r.has_expiry,
      severity: r.severity, neededFor: r.needed_for,
      match: m ? { credentialTypeId: m.credential_type_id, name: m.name, matchedBy: m.matched_by, matchedByName: m.matched_by_name, matchedAt: m.matched_at } : null,
      suggestion: s ? { credentialTypeId: s.id, name: s.name } : null,
    };
  });
}

async function businessName(db: PoolClient, tenantId: string) {
  return (await db.query<{ name: string }>('select name from tenants where id = $1', [tenantId])).rows[0]?.name ?? null;
}

/**
 * Agency connections (backlog item 7, migration 0038): an employer and an agency, both CROP businesses, link up.
 * The employer's owner or admin makes a one-off invitation link and sends it to the agency (outside CROP);
 * the agency's owner or admin opens it while signed in and confirms. Either side can end the link.
 * Only this business's own rows are read here (RLS); the steps that write to both businesses are the checked
 * `app_agency_*` database functions.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class AgencyLinksController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** This business's links (as an employer and as an agency) and the invitations it has made. */
  @Roles(...OFFICE_ROLES)
  @Get('agency-links')
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => {
      // Requirements can change on the employer's side at any time, so each live link's state is brought up to date here.
      const live = (await db.query<{ connection_id: string }>(`select connection_id from agency_connections where status <> 'ended'`)).rows;
      const unmatched = new Map<string, number>();
      for (const l of live) {
        await db.query('select app_agency_refresh($1)', [l.connection_id]);
        unmatched.set(l.connection_id, (await db.query<{ n: number }>('select app_agency_unmatched($1) as n', [l.connection_id])).rows[0].n);
      }
      const w = await wordsFor(db);
      const rows = (await db.query<LinkRow>(
        `select ${LINK_COLS} from agency_connections
          order by status = 'ended', side, preference nulls last, other_name`)).rows;
      const links = [];
      for (const r of rows) {
        const n = unmatched.get(r.connectionId) ?? 0;
        links.push({ ...r, statusWords: linkStatusWords(r.status, r.side, r.otherName, n), ...await siteFacts(db, r, w), ...await roleFacts(db, r, w), unmatched: n });
      }
      const invitations = (await db.query<{ id: string; forName: string | null; createdByName: string | null; createdAt: Date; expiresAt: Date; acceptedAt: Date | null; cancelledAt: Date | null; acceptedBy: string | null }>(
        `select i.id, i.for_name as "forName", i.created_by_name as "createdByName", i.created_at as "createdAt", i.expires_at as "expiresAt",
                i.accepted_at as "acceptedAt", i.cancelled_at as "cancelledAt", c.other_name as "acceptedBy"
           from agency_invitations i left join agency_connections c on c.connection_id = i.connection_id and c.side = 'employer'
          where i.created_at > now() - interval '30 days' or (i.accepted_at is null and i.cancelled_at is null and i.expires_at > now())
          order by i.created_at desc`)).rows.map(i => ({ ...i, state: inviteState(i) }));
      return { links, invitations };
    });
  }

  /**
   * Make an invitation link to send to an agency (`{ forName? }`, the agency's name for your own list).
   * The link is returned once and never stored; it works once, for 7 days.
   */
  @Roles('owner', 'admin')
  @Post('agency-links/invitations')
  invite(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const forName = text(body, 'forName', { max: 120 });
    const { token, hash } = newInviteLink();
    const actor = actorOf(auth);
    return withTenant(this.pool, t.tenantId, async db => {
      const row = (await db.query<{ id: string; expires_at: Date }>(
        `insert into agency_invitations(tenant_id, link_hash, for_name, created_by_name, expires_at)
         values ($1,$2,$3,$4, now() + make_interval(days => $5)) returning id, expires_at`,
        [t.tenantId, hash, forName, actor.name ?? null, INVITE_DAYS])).rows[0];
      await db.query(`insert into agency_events(tenant_id, invitation_id, action, actor_name, actor_business, detail) values ($1,$2,'invited',$3,$4,$5)`,
        [t.tenantId, row.id, actor.name ?? null, await businessName(db, t.tenantId), forName ? `Invitation for ${forName}` : 'Invitation link made']);
      const appUrl = process.env.APP_URL ?? '';
      return { id: row.id, forName, expiresAt: row.expires_at, token, link: appUrl ? inviteUrl(appUrl, token) : null };
    }, actor);
  }

  /** Stop an invitation link working before it is used. */
  @Roles('owner', 'admin')
  @Post('agency-links/invitations/:id/cancel')
  @HttpCode(200)
  cancelInvite(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const actor = actorOf(auth);
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query(`update agency_invitations set cancelled_at = now() where id = $1 and accepted_at is null and cancelled_at is null`, [id]);
      if (!r.rowCount) {
        if (!(await db.query('select 1 from agency_invitations where id = $1', [id])).rowCount) throw new NotFoundException('Invitation not found');
        throw new BadRequestException('That invitation has already been used or cancelled');
      }
      await db.query(`insert into agency_events(tenant_id, invitation_id, action, actor_name, actor_business) values ($1,$2,'invite_cancelled',$3,$4)`,
        [t.tenantId, id, actor.name ?? null, await businessName(db, t.tenantId)]);
      return { id, state: 'cancelled' };
    }, actor);
  }

  /** The order requests go to agencies (`{ connectionIds }`, first = asked first): every live link exactly once. */
  @Roles('owner', 'admin')
  @Put('agency-links/order')
  async order(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const actor = actorOf(auth);
    await withTenant(this.pool, t.tenantId, async db => {
      const live = (await db.query<{ connection_id: string; other_name: string }>(
        `select connection_id, other_name from agency_connections where side = 'employer' and status <> 'ended' for update`)).rows;
      const problem = orderProblem(body?.connectionIds, live.map(l => l.connection_id));
      if (problem) throw new BadRequestException(problem);
      const ids = body.connectionIds as string[];
      if (ids.length > 99) throw new BadRequestException('Too many agencies');
      for (const [i, id] of ids.entries()) {
        await db.query(`update agency_connections set preference = $2 where connection_id = $1 and side = 'employer'`, [id, i + 1]);
      }
      const names = ids.map(id => live.find(l => l.connection_id === id)!.other_name);
      await db.query(`insert into agency_events(tenant_id, action, actor_name, actor_business, detail) values ($1,'order_changed',$2,$3,$4)`,
        [t.tenantId, actor.name ?? null, await businessName(db, t.tenantId), names.map((n, i) => `${i + 1}. ${n}`).join(', ')]);
    }, actor);
    return this.list(t);
  }

  /**
   * Employer side: `{ bookMode?: 'automatic' | 'approve_first', facilityIds?: string[] | null, roles?: string[] | null }`:
   * whether people this agency puts forward are booked straight away, which sites it fills and which roles (null, [] or
   * every one = every site or role, including ones added later). Requests already waiting for this agency's turn skip
   * it if it no longer fills the shift's site or role.
   */
  @Roles('owner', 'admin')
  @Patch('agency-links/:connectionId')
  update(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('connectionId', ParseUUIDPipe) connectionId: string, @Body() body: Record<string, unknown>) {
    const bookMode = body?.bookMode;
    const hasSites = body != null && 'facilityIds' in body;
    const hasRoles = body != null && 'roles' in body;
    if (bookMode === undefined && !hasSites && !hasRoles) throw new BadRequestException('Nothing to change');
    if (bookMode !== undefined && bookMode !== 'automatic' && bookMode !== 'approve_first') throw new BadRequestException('Choose whether to book people straight away or approve them first');
    const actor = actorOf(auth);
    return withTenant(this.pool, t.tenantId, async db => {
      const row = (await db.query<{ side: string; status: string; book_mode: string; facility_ids: string[] | null; roles: string[] | null }>(
        'select side, status, book_mode, facility_ids, roles from agency_connections where connection_id = $1 for update', [connectionId])).rows[0];
      if (!row) throw new NotFoundException('Link not found');
      const w = await wordsFor(db);
      if (row.side !== 'employer') throw new BadRequestException(bookMode !== undefined ? 'Only the employer chooses how people are booked'
        : `Only the employer chooses which ${w.lower(hasSites ? T.site : T.role, true)} an agency fills`);
      if (row.status === 'ended') throw new BadRequestException('This link has ended');
      const business = await businessName(db, t.tenantId);
      if (bookMode !== undefined && row.book_mode !== bookMode) {
        await db.query('update agency_connections set book_mode = $2 where connection_id = $1', [connectionId, bookMode]);
        await db.query(`insert into agency_events(tenant_id, connection_id, action, actor_name, actor_business, detail) values ($1,$2,'book_mode_changed',$3,$4,$5)`,
          [t.tenantId, connectionId, actor.name ?? null, business,
            bookMode === 'automatic' ? 'People put forward are booked straight away' : 'People put forward wait for approval']);
      }
      if (hasSites) {
        const sites = (await db.query<{ id: string; name: string }>('select id, name from facilities order by name')).rows;
        const choice = sitesChoice(body.facilityIds, sites.map(f => f.id), w);
        if ('problem' in choice) throw new BadRequestException(choice.problem);
        const before = row.facility_ids ? [...row.facility_ids].sort() : null;
        if (JSON.stringify(before) !== JSON.stringify(choice.facilityIds)) {
          await db.query('update agency_connections set facility_ids = $2 where connection_id = $1 and side = $3', [connectionId, choice.facilityIds, 'employer']);
          const names = choice.facilityIds ? sites.filter(f => choice.facilityIds!.includes(f.id)).map(f => f.name) : null;
          await db.query(`insert into agency_events(tenant_id, connection_id, action, actor_name, actor_business, detail) values ($1,$2,'sites_changed',$3,$4,$5)`,
            [t.tenantId, connectionId, actor.name ?? null, business, `Fills: ${sitesWords(names, w)}`]);
        }
      }
      if (hasRoles) {
        const choice = rolesChoice(body.roles, await knownRoles(db), w);
        if ('problem' in choice) throw new BadRequestException(choice.problem);
        const before = row.roles ? [...row.roles].sort((a, b) => a.localeCompare(b)) : null;
        if (JSON.stringify(before) !== JSON.stringify(choice.roles)) {
          await db.query('update agency_connections set roles = $2 where connection_id = $1 and side = $3', [connectionId, choice.roles, 'employer']);
          await db.query(`insert into agency_events(tenant_id, connection_id, action, actor_name, actor_business, detail) values ($1,$2,'roles_changed',$3,$4,$5)`,
            [t.tenantId, connectionId, actor.name ?? null, business, `Fills ${w.lower(T.role, true)}: ${rolesWords(choice.roles, w)}`]);
          // Requirements for roles the link doesn't fill don't need matching (migration 0066), so the link may now be
          // ready for requests, or need matching again.
          await db.query('select app_agency_refresh($1)', [connectionId]);
        }
      }
      return linkById(db, connectionId, w);
    }, actor);
  }

  /** End a link, from either side (`{ reason? }`). Both businesses keep the history. */
  @Roles('owner', 'admin')
  @Post('agency-links/:connectionId/end')
  @HttpCode(200)
  end(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('connectionId', ParseUUIDPipe) connectionId: string, @Body() body: Record<string, unknown>) {
    const reason = text(body, 'reason', { max: 300 });
    return withTenant(this.pool, t.tenantId, async db => {
      await db.query('select app_agency_end($1, $2)', [connectionId, reason]);
      return linkById(db, connectionId);
    }, actorOf(auth));
  }

  /** What has happened on a link, newest first (as this business's log has it). */
  @Roles(...OFFICE_ROLES)
  @Get('agency-links/:connectionId/events')
  events(@Tenant() t: Membership, @Param('connectionId', ParseUUIDPipe) connectionId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      await linkById(db, connectionId);
      return (await db.query(
        `select at, action, actor_name as "actorName", actor_business as "actorBusiness", detail from agency_events
          where connection_id = $1 order by at desc, id desc`, [connectionId])).rows;
    });
  }

  /**
   * Agency side: the employer's credential requirements on this link, each with the agency's match (if any) and a
   * suggestion from the shared catalogue code. Must have and should have need a match before requests can be sent;
   * optional ones can be matched but don't have to be.
   */
  @Roles(...OFFICE_ROLES)
  @Get('agency-links/:connectionId/requirements')
  requirements(@Tenant() t: Membership, @Param('connectionId', ParseUUIDPipe) connectionId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const link = await linkById(db, connectionId);
      const reqs = await requirementsFor(db, connectionId);
      const unmatched = (await db.query<{ n: number }>('select app_agency_unmatched($1) as n', [connectionId])).rows[0].n;
      return { link: { ...link, unmatched, statusWords: linkStatusWords(link.status, link.side, link.otherName, unmatched) }, requirements: reqs };
    });
  }

  /**
   * Agency side: which of this business's people meet the employer's requirements today, before any shift arrives
   * (David's answer 1). One group per employer role (role rules plus rules for everyone; "Any role" when it has no
   * role rules) and one per duty, each with this business's active people checked through its current matches:
   * ready (every must-have met and right to work in order), what's missing, and what to check. Uses only this
   * business's records; nothing crosses to the employer.
   */
  @Roles(...OFFICE_ROLES)
  @Get('agency-links/:connectionId/people')
  people(@Tenant() t: Membership, @Param('connectionId', ParseUUIDPipe) connectionId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const link = await linkById(db, connectionId);
      if (link.side !== 'agency') throw new BadRequestException('Only the agency checks its people against an employer’s requirements');
      if (link.status === 'ended') throw new BadRequestException('This link has ended');
      const levels = (await db.query<{ requirement_id: string; kind: RequirementLevel['kind']; label: string; severity: RequirementLevel['severity'] }>(
        'select * from app_agency_requirement_levels($1)', [connectionId])).rows
        .map(r => ({ requirementId: r.requirement_id, kind: r.kind, label: r.label, severity: r.severity }));
      const employerNames = new Map((await requirementsFor(db, connectionId)).map(r => [r.requirementId, r.name]));
      const live = new Map((await db.query<{ employer_credential_type_id: string; credential_type_id: string }>(
        'select employer_credential_type_id, credential_type_id from agency_credential_maps where connection_id = $1', [connectionId])).rows
        .map(m => [m.employer_credential_type_id, m.credential_type_id]));
      const own = new Map((await db.query<{ id: string; name: string }>('select id, name from credential_types where active')).rows.map(c => [c.id, c.name]));
      const groups = readinessGroups(levels, live, own, employerNames, link.roles);

      const ctx = await complianceContext(db, t.tenantId);
      const workers = (await db.query<{ id: string; name: string; roles: string[] }>(
        `select w.id, coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as name, w.roles
           from workers w where w.status = 'active' and ${EMPLOYED_ON('$1')} order by w.last_name, w.first_name`, [ctx.today])).rows;
      const ids = workers.map(w => w.id);
      const creds = ids.length ? await credentialFactsByWorker(db, ids) : new Map();
      const rtw = ids.length ? await rightToWorkByWorker(db, ids) : new Map();
      return {
        link: { connectionId, otherName: link.otherName, status: link.status, rolesWords: link.rolesWords },
        onDate: ctx.today,
        peopleCount: workers.length,
        groups: groups.map(g => {
          const people = rankReadiness(workers.map(w => personReadiness(g, { workerId: w.id, name: w.name, roles: w.roles },
            creds.get(w.id) ?? [], rtw.get(w.id) ?? null, ctx.today, ctx.settings.expiringWindowDays)));
          return { kind: g.kind, label: g.label, unmatched: g.unmatched, ready: people.filter(p => p.ready).length, summary: groupSummary(g, people), people };
        }),
      };
    });
  }

  /**
   * Agency side: match the employer's requirements to this business's credentials
   * (`{ matches: [{ requirementId, credentialTypeId | null }] }`; null removes a match). Returns the requirements again.
   */
  @Roles('owner', 'admin')
  @Put('agency-links/:connectionId/matches')
  async match(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('connectionId', ParseUUIDPipe) connectionId: string, @Body() body: Record<string, unknown>) {
    const list = body?.matches;
    const problem = matchesProblem(list);
    if (problem) throw new BadRequestException(problem);
    const actor = actorOf(auth);
    await withTenant(this.pool, t.tenantId, async db => {
      const reqs = await requirementsFor(db, connectionId);
      const byId = new Map(reqs.map(r => [r.requirementId, r]));
      for (const m of list as Array<{ requirementId: string; credentialTypeId: string | null }>) {
        const req = byId.get(m.requirementId);
        if (!req) throw new BadRequestException('That requirement is no longer on the list. Refresh the page and try again.');
        if (m.credentialTypeId === null) {
          await db.query('delete from agency_credential_maps where connection_id = $1 and employer_credential_type_id = $2', [connectionId, m.requirementId]);
          continue;
        }
        const own = (await db.query<{ active: boolean; catalogue_code: string | null }>(
          'select active, catalogue_code from credential_types where id = $1', [m.credentialTypeId])).rows[0];
        if (!own?.active) throw new BadRequestException(`Choose one of your credentials for ${req.name}`);
        const by = req.catalogueCode && own.catalogue_code === req.catalogueCode ? 'code' : 'hand';
        await db.query(
          `insert into agency_credential_maps(tenant_id, connection_id, employer_credential_type_id, employer_type_name, credential_type_id, matched_by, matched_by_name)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (tenant_id, connection_id, employer_credential_type_id) do update
             set credential_type_id = excluded.credential_type_id, employer_type_name = excluded.employer_type_name,
                 matched_by = excluded.matched_by, matched_by_name = excluded.matched_by_name, matched_at = now()
             where agency_credential_maps.credential_type_id is distinct from excluded.credential_type_id`,
          [t.tenantId, connectionId, m.requirementId, req.name, m.credentialTypeId, by, actor.name ?? null]);
      }
      await db.query('select app_agency_refresh($1)', [connectionId]);
    }, actor);
    return this.requirements(t, connectionId);
  }

  /**
   * The agency opening an invitation link, signed in to its own business: who it is from and whether it can be used.
   * Shows the employer's name only.
   */
  @Roles(...OFFICE_ROLES)
  @Get('agency-invites/:token')
  preview(@Tenant() t: Membership, @Param('token') token: string) {
    if (!INVITE_TOKEN.test(token)) throw new NotFoundException(NOT_VALID);
    return withTenant(this.pool, t.tenantId, async db => {
      const r = (await db.query<{ employer_name: string; state: string; own_business: boolean; already_linked: boolean }>(
        'select * from app_agency_invite_preview($1)', [hashInviteToken(token)])).rows[0];
      if (!r) throw new NotFoundException(NOT_VALID);
      return { employerName: r.employer_name, state: r.state, ownBusiness: r.own_business, alreadyLinked: r.already_linked, business: await businessName(db, t.tenantId) };
    });
  }

  /** The agency's owner or admin confirms the invitation: the two businesses are linked (waiting for matching). */
  @Roles('owner', 'admin')
  @Post('agency-invites/:token/accept')
  @HttpCode(200)
  accept(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('token') token: string) {
    if (!INVITE_TOKEN.test(token)) throw new NotFoundException(NOT_VALID);
    return withTenant(this.pool, t.tenantId, async db => {
      const id = (await db.query<{ id: string }>('select app_agency_accept_invite($1) as id', [hashInviteToken(token)])).rows[0].id;
      await db.query('select app_agency_refresh($1)', [id]);
      return linkById(db, id);
    }, actorOf(auth));
  }
}
