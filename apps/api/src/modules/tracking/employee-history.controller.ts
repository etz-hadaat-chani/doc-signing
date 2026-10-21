import {
  type EmployeeHistoryItem,
  type EmployeeHistoryQuery,
  employeeHistoryQuerySchema,
  type Paged,
} from '@doc-signing/shared';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodQuery } from '../../common/api-docs/api-docs.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import { EmployeeHistoryService } from './employee-history.service.js';

/** The employee card's history (A7, PRD §11): managers and officers. */
@ApiTags('employees')
@Controller('employees')
export class EmployeeHistoryController {
  constructor(private readonly history: EmployeeHistoryService) {}

  @ApiOperation({
    summary: "The employee's history across rounds (FR-TRK-5): newest first, paged",
  })
  @ApiZodQuery(employeeHistoryQuerySchema)
  @Roles('manager', 'officer')
  @Get(':id/assignments')
  list(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Query(new ZodValidationPipe(employeeHistoryQuerySchema)) query: EmployeeHistoryQuery,
  ): Promise<Paged<EmployeeHistoryItem>> {
    return this.history.history(id, query);
  }
}
