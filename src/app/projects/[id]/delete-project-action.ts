"use server";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  customers,
  quotes,
  quoteItems,
  drafts,
  purchaseOrders,
  transactionStatements,
  taxInvoices,
  production,
  notificationLog,
  projectStageLog,
  projectRequests,
  summaryOverrides,
} from "@/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { recordDeletion } from "@/lib/audit/deletion-log";

export type DeleteProjectResult = { ok: true } | { ok: false; error: string };

// 불필요한 프로젝트(잘못 등록했거나 결국 진행되지 않은 건)를 완전히 삭제한다(2026-09-29).
// [id]/quotes/actions.ts의 deleteQuote()와 달리 "후속 문서가 있으면 막는다"가 아니라
// 프로젝트 밑의 모든 문서(견적/시안/발주서/거래명세서/제작 기록 등)를 통째로 함께
// 지운다 — 딱 하나, 이미 국세청에 접수(발행 완료)된 세금계산서가 있으면 막는다. 그건
// 실물 문서가 이미 존재하는 되돌릴 수 없는 외부 사건이라, 앱에서만 지워버리면 실제
// 세금계산서와 우리 기록이 어긋나게 된다.
//
// 삭제 순서는 FK 제약(information_schema로 직접 조회해 확인 — drizzle schema.ts만으로는
// 라이브 DB의 실제 제약과 어긋날 수 있어서, daily_summary_entries 워크트리 드리프트
// 사례 참고)에 맞춰 자식을 부모보다 먼저 지운다. transaction_statements.tax_invoice_id
// ↔ tax_invoices.statement_id는 서로를 참조하는 순환이라, tax_invoices를 지우기 전에
// transaction_statements 쪽 참조를 먼저 끊는다.
//
// 관리자만 가능하고(2026-09-29, 직원 충원 대비 requireAdmin — users.role을 실제로 검사한
// 첫 사례), 삭제 직전에 deletion_log에 한 줄 남긴다.
export async function deleteProject(projectId: string): Promise<DeleteProjectResult> {
  const session = await requireAdmin();

  const [project] = await db
    .select({ id: projects.id, projectNumber: projects.projectNumber, customerName: customers.companyName })
    .from(projects)
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  const issuedInvoice = await db
    .select({ id: taxInvoices.id, invoiceNumber: taxInvoices.invoiceNumber })
    .from(taxInvoices)
    .where(and(eq(taxInvoices.projectId, projectId), eq(taxInvoices.status, "issued")))
    .limit(1);
  if (issuedInvoice.length > 0) {
    return {
      ok: false,
      error: `이미 발행 완료된 세금계산서(${issuedInvoice[0].invoiceNumber})가 있어 이 프로젝트는 삭제할 수 없습니다 — 국세청에 접수된 실물 문서와 앱 기록이 어긋나면 안 됩니다.`,
    };
  }

  const quoteRows = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.projectId, projectId));
  const quoteIds = quoteRows.map((q) => q.id);
  const quoteItemIds = quoteIds.length
    ? (await db.select({ id: quoteItems.id }).from(quoteItems).where(inArray(quoteItems.quoteId, quoteIds))).map(
        (i) => i.id
      )
    : [];

  // 이력용 요약 — 삭제 후에는 못 세니 미리 세어둔다.
  const [draftRows, poRows, stmtRows] = await Promise.all([
    db.select({ id: drafts.id }).from(drafts).where(eq(drafts.projectId, projectId)),
    db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.projectId, projectId)),
    db.select({ id: transactionStatements.id }).from(transactionStatements).where(eq(transactionStatements.projectId, projectId)),
  ]);

  await db.transaction(async (tx) => {
    // 순환 참조 끊기: tax_invoices를 지우기 전에 transaction_statements → tax_invoices 참조를 먼저 없앤다.
    await tx
      .update(transactionStatements)
      .set({ taxInvoiceId: null })
      .where(eq(transactionStatements.projectId, projectId));

    await tx.delete(taxInvoices).where(eq(taxInvoices.projectId, projectId)); // cascade: tax_invoice_items
    await tx.delete(production).where(eq(production.projectId, projectId));
    await tx.delete(transactionStatements).where(eq(transactionStatements.projectId, projectId)); // cascade: statement_items
    await tx.delete(purchaseOrders).where(eq(purchaseOrders.projectId, projectId)); // cascade: po_items
    await tx.delete(drafts).where(eq(drafts.projectId, projectId)); // cascade: draft_images
    await tx.delete(projectRequests).where(eq(projectRequests.projectId, projectId));
    if (quoteItemIds.length) {
      await tx.delete(summaryOverrides).where(inArray(summaryOverrides.rowKey, quoteItemIds));
    }
    await tx.delete(quotes).where(eq(quotes.projectId, projectId)); // cascade: quote_items, quote_tiers
    await tx.delete(notificationLog).where(eq(notificationLog.projectId, projectId));
    await tx.delete(projectStageLog).where(eq(projectStageLog.projectId, projectId));
    await tx.delete(projects).where(eq(projects.id, projectId));
  });

  await recordDeletion(session, "project", `${project.projectNumber} (${project.customerName})`, {
    projectId,
    quoteCount: quoteIds.length,
    draftCount: draftRows.length,
    purchaseOrderCount: poRows.length,
    statementCount: stmtRows.length,
  });

  return { ok: true };
}
