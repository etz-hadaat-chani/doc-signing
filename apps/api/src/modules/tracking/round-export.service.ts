import {
  EXPORT_COLUMNS,
  EXPORT_FILE_SUFFIX,
  requestedDisplayStatuses,
  type RoundExportQuery,
} from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service.js';
import { safeCell } from '../../common/excel/excel-safe.js';
import { AppException } from '../../common/errors/app.exception.js';
import type { TemplateActor } from '../templates/templates.service.js';
import { answerColumns, exportRow } from './export-cells.js';
import { type ExportAnswerRow, TrackingExportRepository } from './tracking-export.repository.js';
import { TrackingRepository } from './tracking.repository.js';
import { windowsSafeName } from './zip-names.js';

/** Arial: good Hebrew and on every Windows computer (Heebo usually isn't installed there). */
const FONT = { name: 'Arial', size: 11 } as const;
const ANSWER_COLUMN_WIDTH = 18;

export interface ExportFile {
  fileName: string;
  content: Buffer;
}

/**
 * The status export to Excel (3.17, FR-TRK-4): one row per assignment with the 3.11 table's
 * filters, department at send, display status and labels; the email section, the approval and
 * one column per box the employee fills in. No ID number, address, birth date or phone
 * (NFR-PRV-6); every text cell formula-safe (NFR-SEC-10). About 1 MB at most for 1,500 rows, so
 * it is built in memory.
 */
@Injectable()
export class RoundExportService {
  constructor(
    private readonly tracking: TrackingRepository,
    private readonly repository: TrackingExportRepository,
    private readonly audit: AuditService,
  ) {}

  async export(
    roundId: string,
    query: RoundExportQuery,
    actor: TemplateActor,
    now = new Date(),
  ): Promise<ExportFile> {
    const roundName = await this.repository.roundName(roundId);
    if (roundName === null) throw new AppException('ROUND_NOT_FOUND', HttpStatus.NOT_FOUND);
    const statuses = requestedDisplayStatuses(query);
    const [rows, extras, positions, answers] = await Promise.all([
      this.tracking.assignmentRows({ roundId, statuses, departmentId: query.dept }, now),
      this.repository.extras(roundId),
      this.repository.boxPositions(roundId),
      this.repository.answers(roundId),
    ]);
    const columns = answerColumns(positions);
    const extraOf = new Map(extras.map((extra) => [extra.assignmentId, extra]));
    const answersOf = new Map<string, Map<string, ExportAnswerRow>>();
    for (const answer of answers) {
      const own = answersOf.get(answer.assignmentId) ?? new Map<string, ExportAnswerRow>();
      own.set(answer.key, answer);
      answersOf.set(answer.assignmentId, own);
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(EXPORT_FILE_SUFFIX, {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = [
      ...EXPORT_COLUMNS.map(({ header, width }) => ({ header, width })),
      ...columns.map(({ header }) => ({ header: safeCell(header), width: ANSWER_COLUMN_WIDTH })),
    ];
    for (const row of rows) {
      sheet.addRow(
        exportRow(
          row,
          extraOf.get(row.assignmentId),
          answersOf.get(row.assignmentId) ?? new Map(),
          columns,
        ),
      );
    }
    sheet.eachRow((row) => {
      row.font = FONT;
      row.alignment = { horizontal: 'right' };
    });
    sheet.getRow(1).font = { ...FONT, bold: true };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };

    const content = Buffer.from(await workbook.xlsx.writeBuffer());
    await this.audit.record({
      actor: { type: 'user', userId: actor.userId },
      action: 'round.exported',
      entity: { type: 'round', id: roundId },
      ip: actor.ip,
      details: {
        statuses,
        departmentId: query.dept ?? null,
        rowCount: rows.length,
        answerColumnCount: columns.length,
      },
    });
    return { fileName: `${windowsSafeName(roundName)} - ${EXPORT_FILE_SUFFIX}.xlsx`, content };
  }
}
