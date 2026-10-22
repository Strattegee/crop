import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { FacilitiesController } from './facilities/facilities.controller.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, FacilitiesController],
})
export class AppModule {}
