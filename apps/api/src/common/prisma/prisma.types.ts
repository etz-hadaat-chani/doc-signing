import type { Prisma } from '../../generated/prisma/client.js';

/**
 * What a data-access method runs its queries on: PrismaService itself, or the `tx` of a
 * transaction a service started. Methods that may take part in a transaction accept
 * `db: Db = this.prisma`.
 */
export type Db = Prisma.TransactionClient;
