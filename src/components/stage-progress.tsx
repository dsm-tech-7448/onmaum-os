export type StageProgressStage = {
  id: string;
  stageCode: string;
  stageName: string;
  sortOrder: number;
  statusColor: string | null;
};

const DRAFT_STAGE_CODES = new Set(["draft_wip", "draft_confirmed"]);

/**
 * 8단계 진행 상황을 색상 세그먼트로 한눈에 보여준다.
 * status_color(project_stages 시드값)를 그대로 사용 —
 * 온마음_주문관리_대시보드.html의 배지 스타일(pill, 옅은 배경 + 진한 글자)을 참고.
 */
export function StageProgress({
  stages,
  currentSortOrder,
  requiresDraft,
}: {
  stages: StageProgressStage[];
  currentSortOrder: number | null;
  requiresDraft: boolean;
}) {
  const currentStage = stages.find((s) => s.sortOrder === currentSortOrder);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        {stages.map((stage) => {
          const isSkipped = !requiresDraft && DRAFT_STAGE_CODES.has(stage.stageCode);
          const isDone = currentSortOrder != null && stage.sortOrder < currentSortOrder;
          const isCurrent = currentSortOrder != null && stage.sortOrder === currentSortOrder;
          const color = stage.statusColor ?? "#9CA3AF";

          return (
            <div
              key={stage.id}
              title={`${stage.sortOrder}. ${stage.stageName}${isSkipped ? " (건너뜀)" : ""}`}
              className={`h-2 flex-1 rounded-full ${isCurrent ? "ring-2 ring-offset-1 ring-neutral-900" : ""}`}
              style={{
                background: isSkipped ? "repeating-linear-gradient(45deg, #e5e5e5, #e5e5e5 3px, #f5f5f5 3px, #f5f5f5 6px)" : color,
                opacity: isSkipped ? 1 : isCurrent ? 1 : isDone ? 0.75 : 0.2,
              }}
            />
          );
        })}
      </div>
      <span className="text-xs text-neutral-500">
        {currentStage
          ? `${currentStage.sortOrder}/8 · ${currentStage.stageName}`
          : "단계 미설정"}
      </span>
    </div>
  );
}
