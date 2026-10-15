import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/db";
import { projects, customers, projectStages, optionMaster, productSuggestions, companyProfile } from "@/db/schema";
import { getBrandAssets } from "@/lib/quotes/brand-assets";
import { generateStatementNumber } from "@/lib/transaction-statements/statement-number";
import { blankStatementDraft } from "@/lib/transaction-statements/blank-draft";
import { StatementEditor } from "./statement-editor";
import { listImportablePOs, listSavedStatements, getInitialStatementQuoteReference } from "./actions";

// 원래 기본 순서는 발주(5단계) 이후지만, 고객 요청으로 견적서와 거래명세서를 함께
// 보내야 하는 경우 발주보다 먼저 보낼 수 있다 — 최소 요건은 견적이 나가 있는 것뿐.
const REQUIRED_STAGE_CODE = "quote";

export default async function ProjectTransactionStatementsPage({
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
      customerName: customers.companyName,
      customerBusinessNumber: customers.businessNumber,
      customerAddress: customers.address,
      currentStageSortOrder: projectStages.sortOrder,
    })
    .from(projects)
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .leftJoin(projectStages, eq(projects.currentStageId, projectStages.id))
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) notFound();

  const [requiredStage] = await db
    .select()
    .from(projectStages)
    .where(eq(projectStages.stageCode, REQUIRED_STAGE_CODE))
    .limit(1);

  const currentSortOrder = project.currentStageSortOrder ?? 0;
  const isBlocked = !requiredStage || currentSortOrder < requiredStage.sortOrder;

  if (isBlocked) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        아직 &ldquo;{requiredStage?.stageName ?? REQUIRED_STAGE_CODE}&rdquo; 단계에 도달하지
        않았습니다.
        <br />
        먼저 견적서를 저장해야 거래명세서를 작성할 수 있습니다.
      </div>
    );
  }

  const [optionRows, productRows, importablePOs, savedStatements, statementNumber, companyRow, quoteReference] =
    await Promise.all([
      db.select().from(optionMaster).orderBy(desc(optionMaster.usageCount)),
      db.select().from(productSuggestions).orderBy(desc(productSuggestions.usageCount)),
      listImportablePOs(projectId),
      listSavedStatements(projectId),
      generateStatementNumber(),
      db.select().from(companyProfile).limit(1),
      getInitialStatementQuoteReference(projectId),
    ]);

  const draft = blankStatementDraft(statementNumber);
  draft.customerName = project.customerName;
  draft.customerBusinessNumber = project.customerBusinessNumber ?? "";
  // 담당자는 고객사마다 자주 바뀌고 여러 명일 수 있어 고객사 마스터에서 끌어오지 않는다 —
  // 견적서에 입력된 담당자를 "불러오기"로 그대로 이어받는다 (customerName과 동일한 방식).
  draft.customerAddress = project.customerAddress ?? "";

  const { seal } = getBrandAssets();
  const profile = companyRow[0];

  return (
    <StatementEditor
      projectId={projectId}
      initialDraft={draft}
      importablePOs={importablePOs}
      savedStatements={savedStatements}
      productNames={productRows.map((p) => p.name)}
      optionNames={optionRows.map((o) => o.name)}
      seal={seal}
      company={{
        companyName: profile?.companyName ?? "주식회사 디에스엠텍 (DSM Tech Inc.)",
        ceoName: profile?.ceoName ?? "신충식",
        businessNumber: profile?.businessNumber ?? "357-88-00511",
        businessType: profile?.businessType ?? "제조업, 도매 및 소매업",
        businessItem: profile?.businessItem ?? "플라스틱제품",
        address: profile?.businessPlaceAddress ?? "",
        bankName: profile?.bankName ?? "",
        accountNumber: profile?.accountNumber ?? "",
        accountHolder: profile?.accountHolder ?? "",
        phone: profile?.phone ?? "",
        email: profile?.email ?? "",
      }}
      initialQuoteReference={quoteReference}
    />
  );
}
