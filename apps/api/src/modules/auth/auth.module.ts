import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessGuard } from './access.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { LoginLimitService } from './login-limit.service.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    LoginLimitService,
    SessionService,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [SessionService],
})
export class AuthModule {}
