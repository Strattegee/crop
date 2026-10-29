import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DbRulesInterceptor } from './common/db-rules.interceptor.js';
import { AgencyLinksController } from './agencies/agency-links.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { ClientsController } from './clients/clients.controller.js';
import { DatabaseModule } from './database/database.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { FacilitiesController } from './facilities/facilities.controller.js';
import { HealthController } from './health/health.controller.js';
import { IndustryController } from './industry/industry.controller.js';
import { PlatformController } from './platform/platform.controller.js';
import { TermsController } from './terms/terms.controller.js';
import { ItemsController, ShiftItemsController, StockController, WorkerItemsController } from './items/items.controller.js';
import { AvailabilityController, LeaveController } from './roster/availability.controller.js';
import { BankFillController } from './roster/bank-fill.controller.js';
import { OfferLinksController } from './roster/offer-links.controller.js';
import { EquipmentController, EquipmentTypesController, ShiftEquipmentController } from './roster/equipment.controller.js';
import { EmploymentController, ShiftCodesController, ShiftsController } from './roster/roster.controller.js';
import { ChangeRequestsController } from './roster/change-requests.controller.js';
import { PublishingController } from './roster/publishing.controller.js';
import { RosterTemplatesController } from './roster/templates.controller.js';
import { ComplianceController } from './workforce/compliance.controller.js';
import { CredentialRequirementsController, CredentialTypesController } from './workforce/credential-types.controller.js';
import { AttentionController } from './roster/attention.controller.js';
import { ShiftDutiesController } from './roster/duties.controller.js';
import { CoverRulesController } from './roster/cover-rules.controller.js';
import { WorkersController } from './workforce/workers.controller.js';
import { OnboardingChecklistsController, WorkerOnboardingController } from './workforce/onboarding.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule, DocumentsModule, NotificationsModule],
  controllers: [
    HealthController, IndustryController, TermsController, PlatformController, ClientsController, FacilitiesController, WorkersController,
    CredentialTypesController, CredentialRequirementsController, ComplianceController,
    ShiftCodesController, ShiftsController, EmploymentController, BankFillController, OfferLinksController, AvailabilityController, LeaveController,
    EquipmentTypesController, EquipmentController, ShiftEquipmentController, PublishingController, ChangeRequestsController, RosterTemplatesController,
    ItemsController, StockController, ShiftItemsController, WorkerItemsController, AttentionController, ShiftDutiesController, CoverRulesController,
    OnboardingChecklistsController, WorkerOnboardingController, AgencyLinksController,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: DbRulesInterceptor }],
})
export class AppModule {}
