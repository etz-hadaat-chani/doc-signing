import {
  type CreateEmployeeInput,
  createEmployeeSchema,
  type EmployeeCard,
  type EmployeeListItem,
  type EmployeeListQuery,
  employeeListQuerySchema,
  employeeSearchSchema,
  type Paged,
  type UpdateEmployeeInput,
  updateEmployeeSchema,
} from '@doc-signing/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody, ApiZodQuery } from '../../common/api-docs/api-docs.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import type { AuthRequest } from '../auth/auth-request.js';
import { type EmployeeActor, EmployeesService } from './employees.service.js';

/** The acting manager. AccessGuard sets `request.auth` on every @Roles route. */
function actorOf(request: AuthRequest): EmployeeActor {
  if (!request.auth) throw new Error('EmployeesController used without a session check');
  return { userId: request.auth.user.id, ip: request.ip ?? null };
}

/** Employees: managers and officers read; only managers add or edit (PRD §9). No delete. */
@ApiTags('employees')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @ApiOperation({
    summary: 'List employees (filters and paging, no search text)',
    description:
      'dept, emailStatus, active=true|false. To search by name, employee number or ID use ' +
      'POST /api/employees/search: search text never goes in a URL.',
  })
  @ApiZodQuery(employeeListQuerySchema)
  @Roles('manager', 'officer')
  @Get()
  list(
    @Query(new ZodValidationPipe(employeeListQuerySchema)) query: EmployeeListQuery,
  ): Promise<Paged<EmployeeListItem>> {
    return this.employees.list(query);
  }

  @ApiOperation({
    summary: 'Search employees: the same filters and paging, plus q in the body',
    description:
      'q matches part of the name, part of the employee number, or the full ID number only.',
  })
  @ApiZodBody(employeeSearchSchema)
  @Roles('manager', 'officer')
  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(
    @Body(new ZodValidationPipe(employeeSearchSchema)) body: EmployeeListQuery,
  ): Promise<Paged<EmployeeListItem>> {
    return this.employees.list(body);
  }

  @ApiOperation({ summary: 'Employee card (the ID number for managers only)' })
  @Roles('manager', 'officer')
  @Get(':id')
  card(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Req() request: AuthRequest,
  ): Promise<EmployeeCard> {
    return this.employees.card(id, request.auth?.user.role ?? 'officer');
  }

  @ApiOperation({ summary: 'Add one employee' })
  @ApiZodBody(createEmployeeSchema)
  @Roles('manager')
  @Post()
  create(
    @Body(new ZodValidationPipe(createEmployeeSchema)) body: CreateEmployeeInput,
    @Req() request: AuthRequest,
  ): Promise<EmployeeCard> {
    return this.employees.create(body, actorOf(request));
  }

  @ApiOperation({ summary: 'Edit an employee' })
  @ApiZodBody(updateEmployeeSchema)
  @Roles('manager')
  @Patch(':id')
  update(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) body: UpdateEmployeeInput,
    @Req() request: AuthRequest,
  ): Promise<EmployeeCard> {
    return this.employees.update(id, body, actorOf(request));
  }
}
