import { Module } from '@nestjs/common';
import { DOCUMENT_STORE, storeFromEnv } from './document-store.js';
import { DocumentsController } from './documents.controller.js';
import { RightToWorkController } from '../workforce/right-to-work.controller.js';
import { UploadLinksController, WorkerUploadLinkController } from '../workforce/upload-links.controller.js';
import { ApplyFormController, JobApplicationsController, PublicApplyController } from '../workforce/apply.controller.js';
import { WorkerDocumentsController } from '../workforce/worker-documents.controller.js';
import { MyCredentialsController, MyRightToWorkController } from '../worker-app/my-credentials.controller.js';

@Module({
  controllers: [DocumentsController, RightToWorkController, MyCredentialsController, MyRightToWorkController, WorkerUploadLinkController, UploadLinksController,
    ApplyFormController, PublicApplyController, JobApplicationsController, WorkerDocumentsController],
  providers: [{ provide: DOCUMENT_STORE, useFactory: storeFromEnv }],
})
export class DocumentsModule {}
