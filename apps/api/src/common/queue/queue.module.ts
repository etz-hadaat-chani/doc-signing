import { type DynamicModule, Module } from '@nestjs/common';
import { QUEUE_MODE, type QueueMode, QueueService } from './queue.service.js';

/** The job queue. The API imports it as `api` (adds jobs), the worker as `worker` (runs them). */
@Module({})
export class QueueModule {
  static forRoot({ mode }: { mode: QueueMode }): DynamicModule {
    return {
      module: QueueModule,
      global: true,
      providers: [{ provide: QUEUE_MODE, useValue: mode }, QueueService],
      exports: [QueueService],
    };
  }
}
