import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { projectStages } from "../src/db/schema";

// 온마음OS_마스터_DB스키마_v3.md "기본 시드값 (요청하신 순서 그대로)"
const STAGES = [
  { sortOrder: 1, stageCode: "inquiry", stageName: "고객 문의", statusColor: "#94A3B8" },
  { sortOrder: 2, stageCode: "quote", stageName: "견적 발송", statusColor: "#60A5FA" },
  { sortOrder: 3, stageCode: "draft_wip", stageName: "인쇄 시안 작성중", statusColor: "#A78BFA" },
  { sortOrder: 4, stageCode: "draft_confirmed", stageName: "고객 시안 확정", statusColor: "#818CF8" },
  { sortOrder: 5, stageCode: "supplier_ordered", stageName: "공급처 발주", statusColor: "#FBBF24" },
  { sortOrder: 6, stageCode: "statement_sent", stageName: "거래명세서 발송", statusColor: "#FB923C" },
  { sortOrder: 7, stageCode: "tax_invoice_issued", stageName: "영수증 발행", statusColor: "#34D399" },
  { sortOrder: 8, stageCode: "shipping_notified", stageName: "배송일정 안내", statusColor: "#4ADE80" },
] as const;

async function main() {
  for (const stage of STAGES) {
    const [existing] = await db
      .select()
      .from(projectStages)
      .where(eq(projectStages.stageCode, stage.stageCode))
      .limit(1);

    if (existing) {
      console.log(`stage already exists: ${stage.stageCode} — skipping`);
      continue;
    }

    await db.insert(projectStages).values(stage);
    console.log(`stage seeded: ${stage.sortOrder}. ${stage.stageName} (${stage.stageCode})`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("project_stages seed failed:", error);
  process.exit(1);
});
