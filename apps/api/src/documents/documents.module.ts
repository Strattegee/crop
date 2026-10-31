import { Module } from '@nestjs/common';
import { DOCUMENT_STORE, storeFromEnv } from './document-store.js';
import { DocumentsController } from './documents.controller.js';
import { RightToWorkController } from '../workforce/right-to-work.controller.js';
import { UploadLinksController, WorkerUploadLinkController } from '../workforce/upload-links.controller.js';
import { MyCredentialsController } from '../worker-app/my-credentials.controller.js';

@Module({
  controllers: [DocumentsController, RightToWorkController, MyCredentialsController, WorkerUploadLinkController, UploadLinksController],
  providers: [{ provide: DOCUMENT_STORE, useFactory: storeFromEnv }],
})
export class DocumentsModule {}
