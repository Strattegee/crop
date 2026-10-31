import {
  BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { auditStore } from '@crop/db';
import type { Pool } from 'pg';
import { APP_POOL } from '../database/database.module.js';
import type { AuthedRequest, MemberRole, Membership } from './auth.types.js';
import { IS_PUBLIC, NO_TENANT, ROLES } from './decorators.js';
import { TokenVerifier } from './token-verifier.js';

/**
 * Runs on every route (registered globally). Verifies the bearer token, records the sign-in,
 * and picks the agency the request acts in:
 *   - one membership: that agency;
 *   - several: the x-tenant header (agency slug) chooses, and must be one of theirs.
 * Then enforces @Roles().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenVerifier) private readonly verifier: TokenVerifier,
    @Inject(APP_POOL) private readonly pool: Pool,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      // Public routes are the one-off links (offers, uploads): the audit log says so.
      const store = auditStore.getStore();
      if (store) store.actor = { via: 'link' };
      return true;
    }

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('sign-in required');

    const claims = await this.verifier.verify(token);
    let user = (await this.pool.query('select * from app_user_by_subject($1)', [claims.sub])).rows[0] as
      | { id: string; email: string; display_name: string | null } | undefined;
    let memberships = user ? await this.memberships(user.id) : [];

    // New user, one with no business yet, or one with an invitation waiting: refresh from the identity provider
    // (invitations are only accepted when it says the email is verified).
    const waiting = !!user && memberships.length > 0
      && (await this.pool.query<{ w: boolean }>('select app_user_has_invite($1) as w', [user.id])).rows[0]?.w;
    if (!user || memberships.length === 0 || waiting) {
      const p = await this.verifier.profile(token);
      if (p.subject !== claims.sub) throw new UnauthorizedException('profile does not match token');
      user = (await this.pool.query('select * from app_sign_in($1, $2, $3, $4)', [p.subject, p.email, p.emailVerified, p.name])).rows[0];
      memberships = await this.memberships(user!.id);
    }

    const noTenant = this.reflector.getAllAndOverride<boolean>(NO_TENANT, targets);
    let tenant: Membership | null = null;
    if (!noTenant) {
      if (memberships.length === 0) throw new ForbiddenException('you have not been given access to a business yet');
      const wanted = req.headers['x-tenant'];
      if (typeof wanted === 'string' && wanted) {
        tenant = memberships.find(m => m.tenantSlug === wanted) ?? null;
        if (!tenant) throw new ForbiddenException('you do not have access to that business');
      } else if (memberships.length === 1) {
        tenant = memberships[0];
      } else {
        throw new BadRequestException('choose a business with the x-tenant header');
      }
      const roles = this.reflector.getAllAndOverride<MemberRole[] | undefined>(ROLES, targets);
      if (roles && !roles.includes(tenant.role)) throw new ForbiddenException('your role does not allow this');
    }

    req.auth = { userId: user!.id, email: user!.email, displayName: user!.display_name, memberships, tenant };
    // Who this request is for, for the audit log (the person in the worker app shows as "app").
    const store = auditStore.getStore();
    if (store) store.actor = { id: user!.id, name: user!.display_name || user!.email, via: tenant?.role === 'worker' ? 'app' : 'office' };
    return true;
  }

  private async memberships(userId: string): Promise<Membership[]> {
    const { rows } = await this.pool.query<{ tenant_id: string; tenant_slug: string; tenant_name: string; role: MemberRole }>(
      'select * from app_user_memberships($1)', [userId],
    );
    return rows.map(r => ({ tenantId: r.tenant_id, tenantSlug: r.tenant_slug, tenantName: r.tenant_name, role: r.role }));
  }
}
