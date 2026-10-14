import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DepartmentsController } from './departments.controller.js';
import { EmployeesController } from './employees.controller.js';
import { EmployeesRepository } from './employees.repository.js';
import { EmployeesService } from './employees.service.js';
import { ImportController } from './import/import.controller.js';
import { ImportRepository } from './import/import.repository.js';
import { ImportService } from './import/import.service.js';

@Module({
  imports: [AuthModule],
  controllers: [EmployeesController, DepartmentsController, ImportController],
  providers: [EmployeesService, EmployeesRepository, ImportService, ImportRepository],
})
export class EmployeesModule {}
