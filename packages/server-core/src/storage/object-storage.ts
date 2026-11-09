import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CORE_CONFIG, type CoreConfig } from '../config.js';

/** Private object storage (docs/02 §7). Large files never go into MongoDB. */
@Injectable()
export class ObjectStorage implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorage.name);
  private readonly memory = new Map<string, { body: Buffer; contentType: string }>();
  private readonly s3: S3Client | null;
  readonly bucket: string;

  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {
    const s = config.storage;
    if (s.driver === 's3') {
      this.s3 = new S3Client({
        region: s.region,
        endpoint: s.endpoint,
        forcePathStyle: s.forcePathStyle,
        credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
      });
      this.bucket = s.bucket;
    } else {
      this.s3 = null;
      this.bucket = 'memory';
    }
  }

  /** Development convenience: create the bucket if the S3 endpoint allows it. */
  async onModuleInit(): Promise<void> {
    if (!this.s3) return;
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket ${this.bucket}`);
      } catch (err) {
        this.logger.warn(
          { err },
          `Bucket ${this.bucket} unavailable; uploads will fail until storage is reachable`,
        );
      }
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.s3) {
      this.memory.set(key, { body, contentType });
      return;
    }
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    if (!this.s3) {
      const v = this.memory.get(key);
      if (!v) throw new Error(`Object not found: ${key}`);
      return v.body;
    }
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    if (!this.s3) {
      this.memory.delete(key);
      return;
    }
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Short-lived download link (docs/02 §7: private assets via signed URLs only). */
  async signedUrl(
    key: string,
    filename: string,
    ttlSec = 300,
  ): Promise<{ url: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + ttlSec * 1000);
    if (!this.s3) return { url: `memory://${key}`, expiresAt };
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${filename.replace(/[^\w.\- ]/g, '_')}"`,
      }),
      { expiresIn: ttlSec },
    );
    return { url, expiresAt };
  }
}
