import type { Department } from '@doc-signing/shared';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/access.decorators.js';
import { EmployeesService } from './employees.service.js';

/** Departments for filters and forms, sorted by code (PRD §7). Read only. */
@ApiTags('departments')
@Roles('manager', 'officer')
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly employees: EmployeesService) {}

  /** The whole list (short; used in dropdowns), so `{ items }` with no paging. */
  @ApiOperation({ summary: 'List departments, sorted by code' })
  @Get()
  async list(): Promise<{ items: Department[] }> {
    return { items: await this.employees.listDepartments() };
  }
}
