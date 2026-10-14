import {
  type CreateUserInput,
  createUserSchema,
  type PageQuery,
  pageQuerySchema,
  type Paged,
  type StaffUser,
  type UpdateUserInput,
  updateUserSchema,
} from '@doc-signing/shared';
import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody, ApiZodQuery } from '../../common/api-docs/api-docs.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import type { AuthRequest } from '../auth/auth-request.js';
import { type UserActor, UsersService } from './users.service.js';

/** The acting manager. AccessGuard sets `request.auth` on every @Roles route. */
function actorOf(request: AuthRequest): UserActor {
  if (!request.auth) throw new Error('UsersController used without a session check');
  return {
    userId: request.auth.user.id,
    sessionId: request.auth.sessionId,
    ip: request.ip ?? null,
  };
}

/** Staff users. Manager only, every route (PRD §9). */
@ApiTags('users')
@Roles('manager')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @ApiOperation({ summary: 'List staff users' })
  @ApiZodQuery(pageQuerySchema)
  @Get()
  list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Paged<StaffUser>> {
    return this.users.list(query);
  }

  @ApiOperation({ summary: 'Create a staff user' })
  @ApiZodBody(createUserSchema)
  @Post()
  create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
    @Req() request: AuthRequest,
  ): Promise<StaffUser> {
    return this.users.create(body, actorOf(request));
  }

  @ApiOperation({ summary: 'Change role, disable, reset password' })
  @ApiZodBody(updateUserSchema)
  @Patch(':id')
  update(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
    @Req() request: AuthRequest,
  ): Promise<StaffUser> {
    return this.users.update(id, body, actorOf(request));
  }
}
