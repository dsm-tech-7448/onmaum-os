import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, projectStages, projectStageLog, type ProjectStage } from "@/db/schema";

// 시안(3. 인쇄 시안작성 / 4. 고객 시안 확정)은 인쇄가 들어가는 건에만 필요.
// 온마음OS_마스터_DB스키마_v3.md "단계 건너뛰기 로직"
const DRAFT_STAGE_CODES = new Set(["draft_wip", "draft_confirmed"]);

/**
 * requiresDraft에 따라 현재 단계 다음으로 실제 진행 가능한 단계를 계산한다.
 * requiresDraft=false면 시안 관련 두 단계를 건너뛴다.
 */
export function getNextStage(
  stages: ProjectStage[],
  currentSortOrder: number | null,
  requiresDraft: boolean
): ProjectStage | null {
  const ordered = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);
  const baseline = currentSortOrder ?? 0;

  for (const stage of ordered) {
    if (stage.sortOrder <= baseline) continue;
    if (!requiresDraft && DRAFT_STAGE_CODES.has(stage.stageCode)) continue;
    return stage;
  }
  return null;
}

async function getCurrentStageSortOrder(projectId: string): Promise<number | null> {
  const [project] = await db
    .select({ currentStageId: projects.currentStageId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project?.currentStageId) return null;

  const [currentStage] = await db
    .select({ sortOrder: projectStages.sortOrder })
    .from(projectStages)
    .where(eq(projectStages.id, project.currentStageId))
    .limit(1);

  return currentStage?.sortOrder ?? null;
}

/**
 * 프로젝트가 아직 requiredStageCode에 도달하지 않았으면 에러를 던진다.
 * "견적을 거치지 않고 발주부터 만드는 경우는 없다"처럼, 순서를 건너뛴 단계 전환을
 * 막을 때 저장 액션 맨 앞에서 호출한다.
 */
export async function assertProjectReachedStage(
  projectId: string,
  requiredStageCode: string
): Promise<void> {
  const [requiredStage] = await db
    .select()
    .from(projectStages)
    .where(eq(projectStages.stageCode, requiredStageCode))
    .limit(1);

  if (!requiredStage) {
    throw new Error(`'${requiredStageCode}' 단계 정의가 없습니다. 시드를 먼저 실행해주세요.`);
  }

  const currentSortOrder = await getCurrentStageSortOrder(projectId);

  if ((currentSortOrder ?? 0) < requiredStage.sortOrder) {
    throw new Error(
      `아직 "${requiredStage.stageName}" 단계에 도달하지 않았습니다. 먼저 이전 단계를 진행해주세요.`
    );
  }
}

/**
 * 프로젝트가 아직 targetStageCode에 도달하지 않았으면(현재 단계가 더 앞이면) 그 단계로
 * 전환하고 project_stage_log에 기록한다. 이미 도달했거나 더 진행된 상태면 아무 것도
 * 하지 않는다 — 리비전을 여러 번 저장해도 중복 전환/역행이 없도록 멱등하게 동작.
 */
export async function advanceProjectStage(
  projectId: string,
  targetStageCode: string,
  changedBy: string | undefined
): Promise<{ advanced: boolean }> {
  const [targetStage] = await db
    .select()
    .from(projectStages)
    .where(eq(projectStages.stageCode, targetStageCode))
    .limit(1);

  if (!targetStage) return { advanced: false };

  const currentSortOrder = await getCurrentStageSortOrder(projectId);

  if (currentSortOrder !== null && currentSortOrder >= targetStage.sortOrder) {
    return { advanced: false };
  }

  await db
    .update(projects)
    .set({ currentStageId: targetStage.id, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  await db.insert(projectStageLog).values({
    projectId,
    stageId: targetStage.id,
    changedBy: changedBy ?? null,
  });

  return { advanced: true };
}
