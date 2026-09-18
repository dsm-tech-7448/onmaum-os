import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/db";
import { projects, projectStages, optionMaster, productSuggestions, companyProfile } from "@/db/schema";
import { getBrandAssets } from "@/lib/quotes/brand-assets";
import { generateInvoiceNumber } from "@/lib/tax-invoices/invoice-number";
import { blankTaxInvoiceDraft } from "@/lib/tax-invoices/blank-draft";
import { TaxInvoiceEditor } from "./tax-invoice-editor";
import { listImportableStatements, listTaxInvoices } from "./actions";

const REQUIRED_STAGE_CODE = "statement_sent";

export default async function ProjectTaxInvoicesPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id: projectId } = await params;

  const [project] = await db
    .select({
      id: projects.id,
      currentStageSortOrder: projectStages.sortOrder,
    })
    .from(projects)
    .leftJoin(projectStages, eq(projects.currentStageId, projectStages.id))
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) notFound();

  // 세금계산서는 거래명세서가 발송된 뒤에만 요청할 수 있다 (6. 거래명세서 발송 완료 이후).
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
        먼저 거래명세서를 발송해야 세금계산서를 요청할 수 있습니다.
      </div>
    );
  }

  const [optionRows, productRows, importableStatements, savedInvoices, invoiceNumber, companyRow] = await Promise.all([
    db.select().from(optionMaster).orderBy(desc(optionMaster.usageCount)),
    db.select().from(productSuggestions).orderBy(desc(productSuggestions.usageCount)),
    listImportableStatements(projectId),
    listTaxInvoices(projectId),
    generateInvoiceNumber(),
    db.select().from(companyProfile).limit(1),
  ]);

  const draft = blankTaxInvoiceDraft(invoiceNumber);

  const { logo, seal } = getBrandAssets();
  const profile = companyRow[0];

  return (
    <TaxInvoiceEditor
      projectId={projectId}
      initialDraft={draft}
      importableStatements={importableStatements}
      savedInvoices={savedInvoices}
      productNames={productRows.map((p) => p.name)}
      optionNames={optionRows.map((o) => o.name)}
      logo={logo}
      seal={seal}
      company={{
        companyName: profile?.companyName ?? "주식회사 디에스엠텍 (DSM Tech Inc.)",
        ceoName: profile?.ceoName ?? "신충식",
        businessNumber: profile?.businessNumber ?? "357-88-00511",
        address: profile?.businessPlaceAddress ?? "",
        phone: profile?.phone ?? "",
        email: profile?.email ?? "",
      }}
    />
  );
}
