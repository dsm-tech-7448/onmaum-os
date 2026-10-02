"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { transactionStatements, statementItems, purchaseOrders, poItems, quotes } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { generateStatementNumber } from "@/lib/transaction-statements/statement-number";
import { advanceProjectStage, assertProjectReachedStage } from "@/lib/projects/stage-transition";
import {
  getQuoteReferenceById as getQuoteReferenceByIdShared,
  getQuoteReferenceByNumber as getQuoteReferenceByNumberShared,
  searchProjectQuotes,
} from "@/app/projects/[id]/quotes/actions";
import type {
  ImportablePO,
  QuoteReferenceSummary,
  QuoteSearchResult,
  StatementDraft,
  StatementItemDraft,
  StatementSummary,
} from "@/lib/transaction-statements/types";

async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  return session;
}

export async function generateNewStatementNumber(): Promise<string> {
  await requireSession();
  return generateStatementNumber();
}

export async function searchQuotesForStatementLink(projectId: string, query: string): Promise<QuoteSearchResult[]> {
  return searchProjectQuotes(projectId, query);
}

// 견적 요약 조회 로직은 quotes/actions.ts에 있고(drafts/purchase-orders와 공유), "use server"
// 파일은 재-export가 아닌 실제 async 함수 선언만 허용하므로 얇게 감싼다.
export async function getQuoteReferenceById(quoteId: string): Promise<QuoteReferenceSummary | null> {
  return getQuoteReferenceByIdShared(quoteId);
}

export async function getQuoteReferenceByNumber(
  projectId: string,
  quoteNumber: string
): Promise<QuoteReferenceSummary | null> {
  return getQuoteReferenceByNumberShared(projectId, quoteNumber);
}

// 페이지를 열었을 때 기본으로 보여줄 견적 — 이 프로젝트에서 가장 최근에 저장한 거래명세서가
// 연결해둔 견적을 그대로 보여준다. 아직 하나도 없으면 자동으로 고르지 않는다(자동 추정 금지).
export async function getInitialStatementQuoteReference(projectId: string): Promise<QuoteReferenceSummary | null> {
  await requireSession();

  const [latest] = await db
    .select({ quoteId: transactionStatements.quoteId })
    .from(transactionStatements)
    .where(eq(transactionStatements.projectId, projectId))
    .orderBy(desc(transactionStatements.createdAt))
    .limit(1);

  if (!latest?.quoteId) return null;
  return getQuoteReferenceById(latest.quoteId);
}

export async function listImportablePOs(projectId: string): Promise<ImportablePO[]> {
  await requireSession();

  const rows = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      revision: purchaseOrders.revision,
      supplierName: purchaseOrders.supplierName,
      quoteId: purchaseOrders.quoteId,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.projectId, projectId))
    .orderBy(desc(purchaseOrders.revision));

  if (rows.length === 0) return [];

  const itemCounts = await db
    .select({ poId: poItems.poId, count: sql<number>`count(*)::int` })
    .from(poItems)
    .where(
      inArray(
        poItems.poId,
        rows.map((r) => r.id)
      )
    )
    .groupBy(poItems.poId);
  const countMap = new Map(itemCounts.map((c) => [c.poId, c.count]));

  const latestByNumber = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestByNumber.has(row.poNumber)) latestByNumber.set(row.poNumber, row);
  }

  return Array.from(latestByNumber.values())
    .sort((a, b) => b.poNumber.localeCompare(a.poNumber))
    .map((r) => ({
      poNumber: r.poNumber,
      latestRevision: r.revision,
      supplierName: r.supplierName,
      itemCount: countMap.get(r.id) ?? 0,
      quoteId: r.quoteId,
    }));
}

export async function importItemsFromPO(
  projectId: string,
  poNumber: string
): Promise<{ purchaseOrderId: string; quoteId: string | null; items: StatementItemDraft[] } | null> {
  await requireSession();

  const [poRow] = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.projectId, projectId), eq(purchaseOrders.poNumber, poNumber)))
    .orderBy(desc(purchaseOrders.revision))
    .limit(1);

  if (!poRow) return null;

  const itemRows = await db.select().from(poItems).where(eq(poItems.poId, poRow.id)).orderBy(poItems.sortOrder);

  return {
    purchaseOrderId: poRow.id,
    quoteId: poRow.quoteId,
    items: itemRows.map((row) => ({
      uid: row.id,
      lineType: row.lineType === "product" ? "product" : "option",
      code: row.code ?? "",
      name: row.name,
      spec: row.spec ?? "",
      unit: row.unit ?? "개",
      qty: row.qty ?? "",
      price: row.price ?? "",
      // po_items 자체엔 quote_item_id가 없다 — 발주는 품목 하나 단위(관례)라 PO 헤더의
      // quote_item_id를 그대로 물려준다.
      quoteItemId: poRow.quoteItemId,
    })),
  };
}

export async function listSavedStatements(projectId: string): Promise<StatementSummary[]> {
  await requireSession();

  const rows = await db
    .select({
      id: transactionStatements.id,
      statementNumber: transactionStatements.statementNumber,
      customerName: transactionStatements.customerName,
      statementDate: transactionStatements.statementDate,
      createdAt: transactionStatements.createdAt,
      quoteNumber: quotes.quoteNumber,
    })
    .from(transactionStatements)
    .leftJoin(quotes, eq(transactionStatements.quoteId, quotes.id))
    .where(eq(transactionStatements.projectId, projectId))
    .orderBy(desc(transactionStatements.createdAt));

  if (rows.length === 0) return [];

  const itemCounts = await db
    .select({ statementId: statementItems.statementId, count: sql<number>`count(*)::int` })
    .from(statementItems)
    .where(
      inArray(
        statementItems.statementId,
        rows.map((r) => r.id)
      )
    )
    .groupBy(statementItems.statementId);
  const countMap = new Map(itemCounts.map((c) => [c.statementId, c.count]));

  return rows.map((r) => ({
    id: r.id,
    statementNumber: r.statementNumber,
    customerName: r.customerName,
    statementDate: r.statementDate,
    itemCount: countMap.get(r.id) ?? 0,
    createdAt: r.createdAt.toISOString(),
    quoteNumber: r.quoteNumber,
  }));
}

export async function loadStatement(projectId: string, statementId: string): Promise<StatementDraft | null> {
  await requireSession();

  const [row] = await db
    .select()
    .from(transactionStatements)
    .where(and(eq(transactionStatements.id, statementId), eq(transactionStatements.projectId, projectId)))
    .limit(1);

  if (!row) return null;

  const itemRows = await db
    .select()
    .from(statementItems)
    .where(eq(statementItems.statementId, row.id))
    .orderBy(statementItems.sortOrder);

  return {
    id: row.id,
    statementNumber: row.statementNumber,
    purchaseOrderId: row.purchaseOrderId,
    quoteId: row.quoteId,
    customerName: row.customerName,
    customerBusinessNumber: row.customerBusinessNumber ?? "",
    customerContactName: row.customerContactName ?? "",
    customerAddress: row.customerAddress ?? "",
    outstandingAmount: row.outstandingAmount ?? "",
    paidCash: row.paidCash ?? "",
    paidCard: row.paidCard ?? "",
    paidDate: row.paidDate ?? "",
    cashReceiptIssuedAt: row.cashReceiptIssuedAt ?? "",
    adjustmentLabel: row.adjustmentLabel ?? "절삭",
    adjustmentAmount: row.adjustmentAmount ?? "",
    statementDate: row.statementDate,
    note: row.note ?? "",
    items: itemRows.map((it) => ({
      uid: it.id,
      lineType: it.lineType === "product" ? "product" : "option",
      code: it.code ?? "",
      name: it.name,
      spec: it.spec ?? "",
      unit: it.unit ?? "개",
      qty: it.qty ?? "",
      price: it.price ?? "",
      supplyOverride: it.supplyOverride ?? "",
      quoteItemId: it.quoteItemId,
    })),
  };
}

export async function saveStatement(projectId: string, draft: StatementDraft): Promise<{ id: string }> {
  const session = await requireSession();

  const statementNumber = draft.statementNumber.trim();
  if (!statementNumber) throw new Error("거래명세서 번호를 입력해주세요.");
  if (!draft.customerName.trim()) throw new Error("수신 고객사를 입력해주세요.");
  if (!draft.quoteId) {
    throw new Error("거래명세서를 저장하려면 먼저 견적서를 불러와 어느 견적에 대한 건인지 선택해주세요.");
  }
  if (draft.items.filter((it) => it.name.trim() !== "").length === 0) {
    throw new Error("품목을 1개 이상 입력해주세요.");
  }

  // statement_number는 유니크 제약이라, 저장된 거래명세서를 "보기"로 불러온 뒤 그대로
  // 다시 저장하면 DB 에러가 난다 — 리비전 없는 문서라 새 번호가 필요하다는 걸 먼저 알려준다.
  const [existing] = await db
    .select({ id: transactionStatements.id })
    .from(transactionStatements)
    .where(eq(transactionStatements.statementNumber, statementNumber))
    .limit(1);
  if (existing) {
    throw new Error(
      `이미 저장된 거래명세서 번호입니다 (${statementNumber}). 거래명세서는 리비전 없이 저장 즉시 확정되는 문서라, 같은 번호로 다시 저장할 수 없습니다 — "거래명세서 번호"를 새 번호로 바꾼 뒤 다시 저장해주세요.`
    );
  }

  // 거래명세서는 원래 발주(5단계) 이후가 기본 순서지만, 고객 요청으로 견적서와
  // 거래명세서를 함께 보내야 하는 경우 발주보다 먼저 보낼 수 있다 — 최소 요건은 견적이
  // 확정돼 있는 것뿐(quoteId가 이미 그 조건을 보장하지만, 명시적으로 한 번 더 확인).
  // 발주서를 나중에 작성해도 되므로, 대시보드 "발주서 작성" 카드는 진행 단계가 아니라
  // 발주서 존재 여부로 따로 확인한다(getProjectsMissingPO).
  await assertProjectReachedStage(projectId, "quote");

  const [created] = await db
    .insert(transactionStatements)
    .values({
      projectId,
      statementNumber,
      purchaseOrderId: draft.purchaseOrderId,
      quoteId: draft.quoteId,
      customerName: draft.customerName.trim(),
      customerBusinessNumber: draft.customerBusinessNumber.trim() || null,
      customerContactName: draft.customerContactName.trim() || null,
      customerAddress: draft.customerAddress.trim() || null,
      outstandingAmount: draft.outstandingAmount.trim() || null,
      adjustmentLabel: draft.adjustmentAmount.trim() ? draft.adjustmentLabel.trim() || "절삭" : null,
      adjustmentAmount: draft.adjustmentAmount.trim() || null,
      statementDate: draft.statementDate,
      note: draft.note || null,
      createdBy: session.userId,
    })
    .returning({ id: transactionStatements.id });

  const itemsToInsert = draft.items
    .filter((it) => it.name.trim() !== "")
    .map((it, idx) => ({
      statementId: created.id,
      quoteItemId: it.quoteItemId || null,
      lineType: it.lineType,
      code: it.code || null,
      name: it.name.trim(),
      spec: it.spec || null,
      unit: it.unit || "개",
      qty: it.qty || null,
      price: it.price || null,
      supplyOverride: it.supplyOverride || null,
      sortOrder: idx,
    }));

  await db.insert(statementItems).values(itemsToInsert);

  await advanceProjectStage(projectId, "statement_sent", session.userId);

  return { id: created.id };
}

// 고객 결제 입력(참고용) — 거래명세서는 리비전이 없는 확정 문서라 기존 행을 그대로 UPDATE한다.
// 카드 결제는 카드 매출전표 자체가 영수증을 대신하므로(세금계산서/현금영수증 별도 발행 불필요),
// 카드 결제액이 입력되면 그 자체로 "영수증 발행"(7단계) 진입 조건을 만족시킨다. 현금 입금은
// 여전히 세금계산서 또는 현금영수증 중 하나를 별도로 발행해야 한다 — 카드만 예외.
export async function recordCustomerPayment(
  projectId: string,
  statementId: string,
  paidCash: string,
  paidCard: string,
  paidDate: string
): Promise<void> {
  const session = await requireSession();

  const [statement] = await db
    .select({ id: transactionStatements.id })
    .from(transactionStatements)
    .where(and(eq(transactionStatements.id, statementId), eq(transactionStatements.projectId, projectId)))
    .limit(1);
  if (!statement) throw new Error("거래명세서를 찾을 수 없습니다.");

  await db
    .update(transactionStatements)
    .set({
      paidCash: paidCash.trim() || null,
      paidCard: paidCard.trim() || null,
      paidDate: paidDate.trim() || null,
    })
    .where(eq(transactionStatements.id, statementId));

  if (paidCard.trim()) {
    await advanceProjectStage(projectId, "tax_invoice_issued", session.userId);
  }
}

// 현금영수증 발행 — 세금계산서와 별개, 둘 중 하나만 발행되면 "영수증 발행"(7단계)으로 진입한다.
export async function markCashReceiptIssued(
  projectId: string,
  statementId: string,
  issuedDate: string
): Promise<void> {
  const session = await requireSession();

  const [statement] = await db
    .select({ id: transactionStatements.id })
    .from(transactionStatements)
    .where(and(eq(transactionStatements.id, statementId), eq(transactionStatements.projectId, projectId)))
    .limit(1);
  if (!statement) throw new Error("거래명세서를 찾을 수 없습니다.");

  const trimmed = issuedDate.trim();
  await db
    .update(transactionStatements)
    .set({ cashReceiptIssuedAt: trimmed || null })
    .where(eq(transactionStatements.id, statementId));

  if (trimmed) {
    await advanceProjectStage(projectId, "tax_invoice_issued", session.userId);
  }
}
