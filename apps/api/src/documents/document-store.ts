import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Where evidence files are kept. Production/staging: DigitalOcean Spaces (S3-compatible), Sydney. */
export interface DocumentStore {
  readonly configured: boolean;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** A short-lived link that opens the file. */
  signedUrl(key: string, filename: string, contentType: string, seconds: number): Promise<string>;
}

export const DOCUMENT_STORE = Symbol('DOCUMENT_STORE');

export class SpacesStore implements DocumentStore {
  readonly configured = true;
  private readonly s3: S3Client;

  constructor(private readonly bucket: string, endpoint: string, key: string, secret: string) {
    // Spaces ignores the region name but the SDK requires one.
    this.s3 = new S3Client({ region: 'us-east-1', endpoint, credentials: { accessKeyId: key, secretAccessKey: secret } });
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ACL: 'private' }));
  }

  signedUrl(key: string, filename: string, contentType: string, seconds: number) {
    const safe = filename.replace(/[^\w.\- ]+/g, '_');
    return getSignedUrl(this.s3, new GetObjectCommand({
      Bucket: this.bucket, Key: key,
      ResponseContentType: contentType,
      ResponseContentDisposition: `inline; filename="${safe}"`,
    }), { expiresIn: seconds });
  }
}

/** Used when storage isn't configured: uploads are refused with a clear message. */
export class DisabledStore implements DocumentStore {
  readonly configured = false;
  async put(): Promise<void> {
    throw new Error('document storage is not configured');
  }
  async signedUrl(): Promise<string> {
    throw new Error('document storage is not configured');
  }
}

/** For tests. */
export class MemoryStore implements DocumentStore {
  readonly configured = true;
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  async signedUrl(key: string, _f: string, _c: string, seconds: number) {
    return `https://storage.test/${key}?expires=${seconds}`;
  }
}

export function storeFromEnv(): DocumentStore {
  const { SPACES_KEY, SPACES_SECRET, SPACES_BUCKET, SPACES_ENDPOINT } = process.env;
  // Local development only: keep files in memory (lost on restart).
  if (process.env.DOCUMENT_STORE === 'memory' && process.env.NODE_ENV !== 'production') return new MemoryStore();
  if (!SPACES_KEY || !SPACES_SECRET || !SPACES_BUCKET) return new DisabledStore();
  return new SpacesStore(SPACES_BUCKET, SPACES_ENDPOINT ?? 'https://syd1.digitaloceanspaces.com', SPACES_KEY, SPACES_SECRET);
}
