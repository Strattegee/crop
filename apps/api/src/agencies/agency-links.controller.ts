import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { actorOf } from '../roster/publishing.js';
import { hashInviteToken, INVITE_DAYS, INVITE_TOKEN, inviteState, inviteUrl, linkStatusWords, newInviteLink, orderProblem, type LinkStatus } from './links.js';

const NOT_VALID = "This link isn't valid. Check you've used the whole link.";

type LinkRow = {
  connectionId: string; side: 'employer' | 'agency'; otherName: string; status: LinkStatus; preference: number | null;
  bookMode: 'automatic' | 'approve_first'; createdAt: Date; endedAt: Date | null; endedByName: string | null;
  endedBySide: 'employer' | 'agency' | null; endReason: string | null;
};
const LINK_COLS = `connection_id as "connectionId", side, other_name as "otherName", status, preference, book_mode as "bookMode",
  created_at as "createdAt", ended_at as "endedAt", ended_by_name as "endedByName", ended_by_side as "endedBySide", end_reason as "endReason"`;

const withWords = (r: LinkRow) => ({ ...r, statusWords: linkStatusWords(r.status, r.side, r.otherName) });

async function linkById(db: PoolClient, connectionId: string) {
  const row = (await db.query<LinkRow>(`select ${LINK_COLS} from agency_connections where connection_id = $1`, [connectionId])).rows[0];
  if (!row) throw new NotFoundException('Link not found');
  return withWords(row);
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
      const links = (await db.query<LinkRow>(
        `select ${LINK_COLS} from agency_connections
          order by status = 'ended', side, preference nulls last, other_name`)).rows.map(withWords);
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

  /** Employer side: `{ bookMode: 'automatic' | 'approve_first' }`, whether people this agency puts forward are booked straight away. */
  @Roles('owner', 'admin')
  @Patch('agency-links/:connectionId')
  update(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('connectionId', ParseUUIDPipe) connectionId: string, @Body() body: Record<string, unknown>) {
    const bookMode = body?.bookMode;
    if (bookMode !== 'automatic' && bookMode !== 'approve_first') throw new BadRequestException('Choose whether to book people straight away or approve them first');
    const actor = actorOf(auth);
    return withTenant(this.pool, t.tenantId, async db => {
      const row = (await db.query<{ side: string; status: string; book_mode: string }>(
        'select side, status, book_mode from agency_connections where connection_id = $1 for update', [connectionId])).rows[0];
      if (!row) throw new NotFoundException('Link not found');
      if (row.side !== 'employer') throw new BadRequestException('Only the employer chooses how people are booked');
      if (row.status === 'ended') throw new BadRequestException('This link has ended');
      if (row.book_mode !== bookMode) {
        await db.query('update agency_connections set book_mode = $2 where connection_id = $1', [connectionId, bookMode]);
        await db.query(`insert into agency_events(tenant_id, connection_id, action, actor_name, actor_business, detail) values ($1,$2,'book_mode_changed',$3,$4,$5)`,
          [t.tenantId, connectionId, actor.name ?? null, await businessName(db, t.tenantId),
            bookMode === 'automatic' ? 'People put forward are booked straight away' : 'People put forward wait for approval']);
      }
      return linkById(db, connectionId);
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
      return linkById(db, id);
    }, actorOf(auth));
  }
}
