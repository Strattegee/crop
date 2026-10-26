import { BadRequestException, Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { PACK_TERMS, TERMS, termByCode } from './terms.js';

export async function termsFor(db: PoolClient) {
  const own = new Map((await db.query<{ code: number; singular: string; plural: string }>('select code, singular, plural from business_terms')).rows.map(r => [r.code, r]));
  return TERMS.map(t => {
    const o = own.get(t.code);
    return { code: t.code, key: t.key, concept: t.concept, singular: o?.singular ?? t.singular, plural: o?.plural ?? t.plural, defaultSingular: t.singular, defaultPlural: t.plural };
  });
}

/** Sets the words an industry template suggests, only where the business has none yet. */
export async function applyPackTerms(db: PoolClient, tenantId: string, packId: string, userId: string) {
  let n = 0;
  for (const [code, w] of Object.entries(PACK_TERMS[packId] ?? {})) {
    if (!w) continue;
    const r = await db.query(
      `insert into business_terms(tenant_id, code, singular, plural, updated_by) values ($1,$2,$3,$4,$5) on conflict do nothing`,
      [tenantId, Number(code), w.singular, w.plural, userId]);
    n += r.rowCount ?? 0;
  }
  return n;
}

/** The business's words for CROP's numbered concepts (one set per business). */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('terms')
export class TermsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Anyone signed in to the business (workers too: the app uses these words). */
  @Get()
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, db => termsFor(db));
  }

  /** Body: { terms: [{ code, singular, plural }] }. An empty singular resets that concept to the default. */
  @Roles('owner', 'admin')
  @Put()
  save(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const raw = body?.terms;
    if (!Array.isArray(raw) || raw.length > 100) throw new BadRequestException('Send a list of words');
    const rows = raw.map(r => {
      const x = r as { code?: unknown; singular?: unknown; plural?: unknown };
      const def = typeof x.code === 'number' ? termByCode(x.code) : undefined;
      if (!def) throw new BadRequestException('Unknown word code');
      const s = typeof x.singular === 'string' ? x.singular.trim() : '';
      const p = typeof x.plural === 'string' && x.plural.trim() ? x.plural.trim() : s;
      if (s.length > 40 || p.length > 40) throw new BadRequestException(`Keep "${def.concept}" to 40 characters`);
      return { code: def.code, singular: s, plural: p };
    });
    return withTenant(this.pool, t.tenantId, async db => {
      for (const r of rows) {
        if (!r.singular) await db.query('delete from business_terms where code = $1', [r.code]);
        else await db.query(
          `insert into business_terms(tenant_id, code, singular, plural, updated_by) values ($1,$2,$3,$4,$5)
           on conflict (tenant_id, code) do update set singular = excluded.singular, plural = excluded.plural, updated_at = now(), updated_by = excluded.updated_by`,
          [t.tenantId, r.code, r.singular, r.plural, auth.userId]);
      }
      return termsFor(db);
    });
  }
}
