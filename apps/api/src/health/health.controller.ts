import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'pg';
import { APP_POOL } from '../database/database.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Get()
  async check() {
    let db: 'up' | 'down' = 'up';
    try {
      await this.pool.query('select 1');
    } catch {
      db = 'down';
    }
    return { status: db === 'up' ? 'ok' : 'degraded', db, version: process.env.APP_VERSION ?? 'dev' };
  }
}
