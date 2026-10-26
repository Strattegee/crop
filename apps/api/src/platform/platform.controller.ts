import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Pool } from 'pg';
import type { AuthContext, MemberRole } from '../auth/auth.types.js';
import { Auth, NoTenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';

const ROLES: MemberRole[] = ['owner', 'admin', 'allocator', 'worker', 'client'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Short code for a business from its name: "The Grand Café" → "the-grand-cafe". */
export function slugFor(name: string) {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36).replace(/-+$/, '');
  return s.length >= 2 ? s : `business-${s || 'new'}`;
}

function pgFail(e: unknown): never {
  const err = e as { code?: string; hint?: string; message?: string };
  if (err.code === '42501') throw new ForbiddenException('Only CROP platform administrators can do this');
  if (err.hint === 'last_owner') throw new BadRequestException('Every business needs an owner. Make someone else an owner first.');
  if (err.code === 'P0002') throw new NotFoundException('Business not found');
  throw e;
}

/**
 * Strattegee's platform screen: every business on CROP and who can sign in to each.
 * Not tied to one business (@NoTenant); the database functions check the caller is a platform admin.
 */
@ApiBearerAuth()
@NoTenant()
@Controller('platform')
export class PlatformController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  private q<T>(sql: string, params: unknown[]) {
    return this.pool.query(sql, params).then(r => r.rows as T[]).catch(pgFail);
  }

  @Get('businesses')
  async businesses(@Auth() a: AuthContext) {
    return this.q('select id, slug, name, created_at as "createdAt", people, invited, owners from app_platform_tenants($1)', [a.userId]);
  }

  /** Body: { name, ownerEmail? }. Creates the business and, if given, invites its first owner. */
  @Post('businesses')
  async create(@Auth() a: AuthContext, @Body() body: Record<string, unknown>) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (name.length < 2 || name.length > 80) throw new BadRequestException('Give the business a name (2 to 80 characters)');
    const ownerEmail = typeof body?.ownerEmail === 'string' && body.ownerEmail.trim() ? body.ownerEmail.trim().toLowerCase() : null;
    if (ownerEmail && !EMAIL.test(ownerEmail)) throw new BadRequestException('That email address doesn’t look right');
    const existing = new Set((await this.businesses(a)).map(b => (b as { slug: string }).slug));
    const base = slugFor(name);
    let slug = base;
    for (let n = 2; existing.has(slug); n++) slug = `${base}-${n}`;
    const [{ id }] = await this.q<{ id: string }>('select app_platform_create_tenant($1, $2, $3) as id', [a.userId, slug, name]);
    if (ownerEmail) await this.q('select app_platform_invite($1, $2, $3, $4)', [a.userId, id, ownerEmail, 'owner']);
    return { id, slug, name };
  }

  @Get('businesses/:id')
  async business(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const b = (await this.businesses(a)).find(x => (x as { id: string }).id === id);
    if (!b) throw new NotFoundException('Business not found');
    const people = await this.q('select status, email, name, role, since, last_seen as "lastSeen" from app_platform_people($1, $2)', [a.userId, id]);
    return { ...b, people };
  }

  /** Body: { email, role }. Gives access (or changes the role); an invitation if they haven't signed in yet. */
  @Put('businesses/:id/people')
  async put(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body?.role as MemberRole;
    if (!EMAIL.test(email)) throw new BadRequestException('That email address doesn’t look right');
    if (!ROLES.includes(role)) throw new BadRequestException('Choose a role: owner, admin, allocator, worker or client');
    const action = body?.change === true ? 'set_role' : 'invite';
    const [{ status }] = await this.q<{ status: string }>('select app_platform_invite($1, $2, $3, $4, $5) as status', [a.userId, id, email, role, action]);
    return { email, role, status };
  }

  @Delete('businesses/:id/people/:email')
  @HttpCode(200)
  async remove(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('email') email: string) {
    const [{ n }] = await this.q<{ n: number }>('select app_platform_remove($1, $2, $3) as n', [a.userId, id, email]);
    if (!n) throw new NotFoundException('That person doesn’t have access to this business');
    return { removed: n };
  }
}
