"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projectRequests } from "@/db/schema";
import { getSession } from "@/lib/auth/session";

async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  return session;
}

export type ProjectRequestItem = {
  id: string;
  source: string;
  content: string;
  requestedAt: string;
  resolvedAt: string | null;
};

export async function listProjectRequests(projectId: string): Promise<ProjectRequestItem[]> {
  await requireSession();

  const rows = await db
    .select()
    .from(projectRequests)
    .where(eq(projectRequests.projectId, projectId))
    .orderBy(desc(projectRequests.requestedAt));

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    content: r.content,
    requestedAt: r.requestedAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  }));
}

export async function addProjectRequest(projectId: string, source: string, content: string): Promise<void> {
  const session = await requireSession();
  if (!content.trim()) throw new Error("요청 내용을 입력해주세요.");

  await db.insert(projectRequests).values({
    projectId,
    source,
    content: content.trim(),
    createdBy: session.userId,
  });
}

export async function resolveProjectRequest(requestId: string): Promise<void> {
  await requireSession();

  await db
    .update(projectRequests)
    .set({ resolvedAt: new Date() })
    .where(and(eq(projectRequests.id, requestId), isNull(projectRequests.resolvedAt)));
}
