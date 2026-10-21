import type { EmployeeHistoryItem, EmployeeHistoryQuery, Paged } from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import { toHistoryItem } from './tracking-rows.js';
import { TrackingRepository } from './tracking.repository.js';

/** The employee card's history across rounds (A7, FR-TRK-5): newest round first, paged. */
@Injectable()
export class EmployeeHistoryService {
  constructor(private readonly repository: TrackingRepository) {}

  async history(
    employeeId: string,
    query: EmployeeHistoryQuery,
    now = new Date(),
  ): Promise<Paged<EmployeeHistoryItem>> {
    if (!(await this.repository.employeeExists(employeeId))) {
      throw new AppException('EMPLOYEE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const { rows, total } = await this.repository.historyPage(
      employeeId,
      query.page,
      query.pageSize,
      now,
    );
    return { items: rows.map(toHistoryItem), total, page: query.page, pageSize: query.pageSize };
  }
}
