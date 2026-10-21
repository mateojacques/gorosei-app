import type { Executor } from "./db/client";
import { auditLog } from "./db/schema";

export type AuditEntry = {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  data?: unknown;
};

export async function writeAudit(db: Executor, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({ ...entry, data: entry.data ?? null });
}
