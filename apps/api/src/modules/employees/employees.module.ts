import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DepartmentsController } from './departments.controller.js';
import { EmployeesController } from './employees.controller.js';
import { EmployeesRepository } from './employees.repository.js';
import { EmployeesService } from './employees.service.js';

@Module({
  imports: [AuthModule],
  controllers: [EmployeesController, DepartmentsController],
  providers: [EmployeesService, EmployeesRepository],
})
export class EmployeesModule {}
