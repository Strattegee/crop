import { Module } from '@nestjs/common';
import { DOCUMENT_STORE, storeFromEnv } from './document-store.js';
import { DocumentsController } from './documents.controller.js';

@Module({
  controllers: [DocumentsController],
  providers: [{ provide: DOCUMENT_STORE, useFactory: storeFromEnv }],
})
export class DocumentsModule {}
