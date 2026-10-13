import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/access.decorators.js';
import { HealthService, type HealthStatus } from './health.service.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** 200 when the database answers, 503 when it doesn't. */
  @Get()
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthStatus> {
    const result = await this.health.check();
    response.status(result.database === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
