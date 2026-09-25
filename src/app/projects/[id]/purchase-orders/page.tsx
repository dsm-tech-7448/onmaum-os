import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/db";
import { projects, projectStages, optionMaster, productSuggestions, companyProfile } from "@/db/schema";
import { getBrandAssets } from "@/lib/quotes/brand-assets";
import { generatePoNumber } from "@/lib/purchase-orders/po-number";
import { blankPoDraft } from "@/lib/purchase-orders/blank-draft";
import { PoEditor } from "./po-editor";
import { searchProjectPOs, getInitialPoQuoteReference } from "./actions";

export default async function ProjectPurchaseOrdersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id: projectId } = await params;

  const [project] = await db
    .select({
      id: projects.id,
      requiresDraft: projects.requiresDraft,
      currentStageSortOrder: projectStages.sortOrder,
    })
    .from(projects)
    .leftJoin(projectStages, eq(projects.currentStageId, projectStages.id))
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) notFound();

  // 견적을 거치지 않고 발주부터 만드는 경우는 없다 — requires_draft에 따라
  // 인쇄 시안 작성(3) 또는 견적 발송(2) 이후에만 발주 작성 화면을 연다.
  // 고객의 시안 확정은 이메일/문자로 별도 전달되고 앱에 입력하지 않으므로,
  // "고객 시안 확정"(4) 단계까지 기다리지 않고 시안을 작성만 해도 발주서를 작성할 수 있다.
  const requiredStageCode = project.requiresDraft ? "draft_wip" : "quote";
  const [requiredStage] = await db
    .select()
    .from(projectStages)
    .where(eq(projectStages.stageCode, requiredStageCode))
    .limit(1);

  const currentSortOrder = project.currentStageSortOrder ?? 0;
  const isBlocked = !requiredStage || currentSortOrder < requiredStage.sortOrder;

  if (isBlocked) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        아직 &ldquo;{requiredStage?.stageName ?? requiredStageCode}&rdquo; 단계에 도달하지
        않았습니다.
        <br />
        {project.requiresDraft
          ? "먼저 시안을 작성해야 발주서를 작성할 수 있습니다."
          : "먼저 견적을 저장해야 발주서를 작성할 수 있습니다."}
      </div>
    );
  }

  const [optionRows, productRows, poList, poNumber, companyRow, quoteReference] = await Promise.all([
    db.select().from(optionMaster).orderBy(desc(optionMaster.usageCount)),
    db.select().from(productSuggestions).orderBy(desc(productSuggestions.usageCount)),
    searchProjectPOs(projectId, ""),
    generatePoNumber(),
    db.select().from(companyProfile).limit(1),
    getInitialPoQuoteReference(projectId),
  ]);

  const draft = blankPoDraft(poNumber);
  draft.items = [
    { uid: "seed-product", lineType: "product", code: "", name: "", spec: "", unit: "개", qty: "", price: "" },
  ];

  const { logo } = getBrandAssets();
  const profile = companyRow[0];

  return (
    <PoEditor
      projectId={projectId}
      initialDraft={draft}
      initialPoList={poList}
      initialQuoteReference={quoteReference}
      productNames={productRows.map((p) => p.name)}
      optionNames={optionRows.map((o) => o.name)}
      logo={logo}
      company={{
        companyName: profile?.companyName ?? "주식회사 디에스엠텍 (DSM Tech Inc.)",
        ceoName: profile?.ceoName ?? "신충식",
        businessNumber: profile?.businessNumber ?? "357-88-00511",
        businessType: profile?.businessType ?? "제조업, 도매 및 소매업",
        businessItem: profile?.businessItem ?? "플라스틱제품",
        address: profile?.businessPlaceAddress ?? "",
        phone: profile?.phone ?? "",
        email: profile?.email ?? "",
        fax: profile?.fax ?? "",
      }}
    />
  );
}
