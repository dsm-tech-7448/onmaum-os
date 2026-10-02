import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { deletionLog } from "@/db/schema";
import type { SessionPayload } from "@/lib/auth/session";

// 삭제 액션(프로젝트/견적서/Daily Summary 행)에서 공통으로 쓰는 이력 기록 헬퍼(2026-09-29).
// 실제 삭제 직전에 호출해서, 삭제 자체가 실패해도 이력만 남는 일이 없게 한다(호출 순서는
// 각 액션에서 삭제 성공 이후로 맞춘다).
export async function recordDeletion(
  session: SessionPayload,
  entityType: "project" | "quote" | "daily_summary_entry",
  entityLabel: string,
  snapshot?: Record<string, unknown>
): Promise<void> {
  await db.insert(deletionLog).values({
    entityType,
    entityLabel,
    snapshot: snapshot ?? null,
    deletedByEmail: session.email,
    deletedByName: session.name,
  });
}

export async function listDeletionLog(limit = 200) {
  return db.select().from(deletionLog).orderBy(desc(deletionLog.deletedAt)).limit(limit);
}
