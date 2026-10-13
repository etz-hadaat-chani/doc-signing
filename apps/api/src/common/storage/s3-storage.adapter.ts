import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../config/config.schema.js';
import { contentDisposition } from './content-disposition.js';
import {
  type DownloadLinkOptions,
  type DownloadStream,
  MAX_DOWNLOAD_LINK_SECONDS,
  StorageAdapter,
  type UploadOptions,
  type UploadResult,
} from './storage.adapter.js';
import { StorageAlreadyExistsError, StorageNotFoundError } from './storage.errors.js';
import { assertValidStorageKey } from './storage-key.js';

/** S3-compatible storage: MinIO locally, AWS S3 in production. */
@Injectable()
export class S3StorageAdapter extends StorageAdapter implements OnModuleInit, OnModuleDestroy {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: AppConfig) {
    super();
    const { endpoint, region, bucket, credentials, forcePathStyle } = config.storage;
    this.bucket = bucket;
    this.client = new S3Client({
      endpoint,
      region,
      // A copy: the config is frozen and the SDK adds fields to the credentials object.
      credentials: credentials && { ...credentials },
      forcePathStyle,
      // The SDK's default CRC checksums aren't supported everywhere (e.g. some MinIO builds);
      // upload sends its own SHA-256 checksum instead.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /**
   * Checks the bucket at startup. Dev and test create it when missing (new buckets are
   * private; no policy is ever set). Production never creates it: it's set up with the
   * infrastructure (encryption at rest, public access blocked).
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch (error) {
      if (!isNotFound(error)) {
        throw new Error(`Storage bucket check failed (${errorSummary(error)})`, { cause: error });
      }
    }
    if (this.config.nodeEnv === 'production') {
      throw new Error('Storage bucket not found; create it before starting the app');
    }
    const region = this.config.storage.region;
    try {
      await this.client.send(
        new CreateBucketCommand({
          Bucket: this.bucket,
          CreateBucketConfiguration:
            region === 'us-east-1'
              ? undefined
              : { LocationConstraint: region as BucketLocationConstraint },
        }),
      );
    } catch (error) {
      // Another process created it first.
      if (errorName(error) !== 'BucketAlreadyOwnedByYou') {
        throw new Error(`Storage bucket create failed (${errorSummary(error)})`, { cause: error });
      }
    }
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  async upload(key: string, body: Buffer, { contentType }: UploadOptions): Promise<UploadResult> {
    assertValidStorageKey(key);
    const digest = createHash('sha256').update(body).digest();
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
          // The server checks the bytes it received against this hash.
          ChecksumSHA256: digest.toString('base64'),
          // Conditional write: refused if the key exists, so a signed PDF can't be replaced.
          IfNoneMatch: '*',
        }),
      );
    } catch (error) {
      // 412: the key exists. 409: a parallel conditional write to the same key.
      const status = httpStatus(error);
      if (status === 412 || status === 409) {
        throw new StorageAlreadyExistsError(key);
      }
      throw error;
    }
    return { key, size: body.length, sha256: digest.toString('hex') };
  }

  async download(key: string): Promise<Buffer> {
    const { stream } = await this.downloadStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async downloadStream(key: string): Promise<DownloadStream> {
    assertValidStorageKey(key);
    try {
      const output = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!(output.Body instanceof Readable)) {
        throw new Error('Storage returned no readable body');
      }
      return { stream: output.Body, size: output.ContentLength, contentType: output.ContentType };
    } catch (error) {
      if (isNotFound(error)) {
        throw new StorageNotFoundError(key);
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    assertValidStorageKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  async createDownloadLink(
    key: string,
    {
      fileName,
      disposition = 'attachment',
      expiresInSeconds = MAX_DOWNLOAD_LINK_SECONDS,
    }: DownloadLinkOptions,
  ): Promise<string> {
    assertValidStorageKey(key);
    if (
      !Number.isInteger(expiresInSeconds) ||
      expiresInSeconds < 1 ||
      expiresInSeconds > MAX_DOWNLOAD_LINK_SECONDS
    ) {
      throw new Error(`Download link expiry must be 1–${MAX_DOWNLOAD_LINK_SECONDS} seconds`);
    }
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: contentDisposition(fileName, disposition),
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}

function httpStatus(error: unknown): number | undefined {
  return error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

/** Name and message for startup errors; SDK messages never carry the keys. */
function errorSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
}

function isNotFound(error: unknown): boolean {
  return httpStatus(error) === 404;
}
