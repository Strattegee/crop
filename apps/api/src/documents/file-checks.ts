import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { DocumentStore } from './document-store.js';
import { cleanFilename, sniffType } from './sniff.js';

/** Checks an uploaded file and stores it; returns what to record in credential_documents. */
export async function checkAndStore(store: DocumentStore, tenantId: string, file: Express.Multer.File | undefined, folder: string) {
  if (!store.configured) throw new ServiceUnavailableException('Document storage is not set up yet');
  if (!file?.buffer?.length) throw new BadRequestException('Choose a file to upload');
  const contentType = sniffType(file.buffer);
  if (!contentType) throw new BadRequestException('Only PDF, JPEG, PNG or HEIC files can be uploaded');
  const key = `${tenantId}/${folder}/${randomUUID()}`;
  await store.put(key, file.buffer, contentType);
  return {
    key, contentType, filename: cleanFilename(file.originalname), size: file.size,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
  };
}
