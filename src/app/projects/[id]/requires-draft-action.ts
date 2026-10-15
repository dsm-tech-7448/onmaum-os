"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { getSession } from "@/lib/auth/session";

// 프로젝트를 만들 때 "인쇄 시안 필요" 체크를 잘못 둔 경우를 나중에 바로잡는다(2026-10-15).
// 단계(currentStage)는 건드리지 않는다 — 해제하면 시안 단계(3·4)를 건너뛰는 것으로 다시 계산되고
// (getNextStage/StageProgress), 발주서는 "견적 발송" 단계만 넘으면 작성할 수 있다. 이미 작성된
// 시안 데이터는 지우지 않고, 시안 탭만 숨겨진다.
export async function setRequiresDraft(projectId: string, requiresDraft: boolean): Promise<void> {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");

  const result = await db
    .update(projects)
    .set({ requiresDraft, updatedAt: new Date() })
    .where(eq(projects.id, projectId))
    .returning({ id: projects.id });
  if (result.length === 0) throw new Error("프로젝트를 찾을 수 없습니다.");
}
