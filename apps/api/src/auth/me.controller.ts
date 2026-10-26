import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'pg';
import { APP_POOL } from '../database/database.module.js';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { AuthContext } from './auth.types.js';
import { Auth, NoTenant } from './decorators.js';

@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** The signed-in person and the agencies they can act in. */
  @NoTenant()
  @Get()
  async me(@Auth() auth: AuthContext) {
    const platformAdmin = (await this.pool.query<{ p: boolean }>('select app_is_platform_admin($1) as p', [auth.userId])).rows[0]?.p ?? false;
    return { id: auth.userId, email: auth.email, name: auth.displayName, memberships: auth.memberships, platformAdmin };
  }
}
