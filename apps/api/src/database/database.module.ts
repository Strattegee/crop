import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { createPool } from '@crop/db';
import type { Pool } from 'pg';

export const APP_POOL = Symbol('APP_POOL');

@Injectable()
class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

/** Connection pool for the crop_app role, which is always subject to row-level security. */
@Global()
@Module({
  providers: [
    {
      provide: APP_POOL,
      useFactory: () => {
        const url = process.env.APP_DATABASE_URL;
        if (!url) throw new Error('APP_DATABASE_URL is not set');
        return createPool(url);
      },
    },
    PoolCloser,
  ],
  exports: [APP_POOL],
})
export class DatabaseModule {}
