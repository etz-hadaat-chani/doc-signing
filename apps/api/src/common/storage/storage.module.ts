import { Global, Module } from '@nestjs/common';
import { S3StorageAdapter } from './s3-storage.adapter.js';
import { StorageAdapter } from './storage.adapter.js';

/** File storage. Azure Blob later = another StorageAdapter class here. */
@Global()
@Module({
  providers: [{ provide: StorageAdapter, useClass: S3StorageAdapter }],
  exports: [StorageAdapter],
})
export class StorageModule {}
