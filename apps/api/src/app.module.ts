import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ClientsController } from './clients/clients.controller.js';
import { DatabaseModule } from './database/database.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { FacilitiesController } from './facilities/facilities.controller.js';
import { HealthController } from './health/health.controller.js';
import { ComplianceController } from './workforce/compliance.controller.js';
import { CredentialRequirementsController, CredentialTypesController } from './workforce/credential-types.controller.js';
import { WorkersController } from './workforce/workers.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule, DocumentsModule],
  controllers: [
    HealthController, ClientsController, FacilitiesController, WorkersController,
    CredentialTypesController, CredentialRequirementsController, ComplianceController,
  ],
})
export class AppModule {}
