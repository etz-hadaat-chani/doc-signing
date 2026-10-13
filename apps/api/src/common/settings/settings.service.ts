import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Db } from '../prisma/prisma.types.js';
import { SETTING_DEFAULTS } from './settings.defaults.js';

/** A display name for the From header: one line, not empty. */
const senderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\r\n]*$/);

/** Reads settings, falling back to `SETTING_DEFAULTS`. Task 3.18 adds reading all and updating. */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The From display name of every email. A missing or bad value gives the built-in default. */
  async getSenderName(db: Db = this.prisma): Promise<string> {
    const row = await db.setting.findUnique({ where: { key: 'sender_name' } });
    const parsed = senderNameSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : SETTING_DEFAULTS.sender_name;
  }
}
