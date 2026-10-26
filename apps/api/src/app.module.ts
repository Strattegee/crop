import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ClientsController } from './clients/clients.controller.js';
import { DatabaseModule } from './database/database.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { FacilitiesController } from './facilities/facilities.controller.js';
import { HealthController } from './health/health.controller.js';
import { IndustryController } from './industry/industry.controller.js';
import { ItemsController, ShiftItemsController, StockController, WorkerItemsController } from './items/items.controller.js';
import { BankFillController } from './roster/bank-fill.controller.js';
import { OfferLinksController } from './roster/offer-links.controller.js';
import { EquipmentController, EquipmentTypesController, ShiftEquipmentController } from './roster/equipment.controller.js';
import { EmploymentController, ShiftCodesController, ShiftsController } from './roster/roster.controller.js';
import { ComplianceController } from './workforce/compliance.controller.js';
import { CredentialRequirementsController, CredentialTypesController } from './workforce/credential-types.controller.js';
import { WorkersController } from './workforce/workers.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule, DocumentsModule, NotificationsModule],
  controllers: [
    HealthController, IndustryController, ClientsController, FacilitiesController, WorkersController,
    CredentialTypesController, CredentialRequirementsController, ComplianceController,
    ShiftCodesController, ShiftsController, EmploymentController, BankFillController, OfferLinksController,
    EquipmentTypesController, EquipmentController, ShiftEquipmentController,
    ItemsController, StockController, ShiftItemsController, WorkerItemsController,
  ],
})
export class AppModule {}
