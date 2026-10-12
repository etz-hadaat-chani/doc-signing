import { Module } from '@nestjs/common';
import { DatabaseCheckService } from './database-check.service.js';

@Module({
  providers: [DatabaseCheckService],
})
export class DatabaseModule {}
