import {
  type CreateEmployeeInput,
  createEmployeeSchema,
  type EmployeeCard,
  type EmployeeListItem,
  type EmployeeListQuery,
  employeeListQuerySchema,
  type Paged,
  type UpdateEmployeeInput,
  updateEmployeeSchema,
} from '@doc-signing/shared';
import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
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
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Roles('manager', 'officer')
  @Get()
  list(
    @Query(new ZodValidationPipe(employeeListQuerySchema)) query: EmployeeListQuery,
  ): Promise<Paged<EmployeeListItem>> {
    return this.employees.list(query);
  }

  @Roles('manager', 'officer')
  @Get(':id')
  card(@Param('id', new ZodValidationPipe(z.uuid())) id: string): Promise<EmployeeCard> {
    return this.employees.card(id);
  }

  @Roles('manager')
  @Post()
  create(
    @Body(new ZodValidationPipe(createEmployeeSchema)) body: CreateEmployeeInput,
    @Req() request: AuthRequest,
  ): Promise<EmployeeCard> {
    return this.employees.create(body, actorOf(request));
  }

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
