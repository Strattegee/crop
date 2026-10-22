import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Pool } from 'pg';
import { APP_POOL } from '../database/database.module.js';

export interface TenantRequest {
  headers: Record<string, string | string[] | undefined>;
  tenantId?: string;
}

/**
 * TEMPORARY: picks the tenant from the x-tenant header (the agency's slug).
 * Replaced by the signed-in user's tenant once the identity provider is wired in (ACC- requirements).
 * Do not ship to production with this guard.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    const slug = req.headers['x-tenant'];
    if (typeof slug !== 'string' || !slug) throw new UnauthorizedException('x-tenant header required');
    const { rows } = await this.pool.query<{ id: string }>('select id from tenants where slug = $1', [slug]);
    if (!rows[0]) throw new UnauthorizedException('unknown tenant');
    req.tenantId = rows[0].id;
    return true;
  }
}
