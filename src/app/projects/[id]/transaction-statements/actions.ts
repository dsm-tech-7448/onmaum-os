"use server";

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  transactionStatements,
  statementItems,
  purchaseOrders,
  poItems,
  quotes,
  quoteItems,
  projects,
} from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { generateStatementNumber } from "@/lib/transaction-statements/statement-number";
import {
  advanceLinkedProjects,
  advanceProjectStage,
  assertProjectReachedStage,
} from "@/lib/projects/stage-transition";
import {
  getQuoteReferenceById as getQuoteReferenceByIdShared,
  getQuoteReferenceByNumber as getQuoteReferenceByNumberShared,
  getQuoteRevisions,
  searchProjectQuotes,
} from "@/app/projects/[id]/quotes/actions";
import type { QuoteRevisionSummary } from "@/lib/quotes/types";
import type {
  BundleQuoteOption,
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
  quoteNumber: string,
  revision?: number
): Promise<QuoteReferenceSummary | null> {
  return getQuoteReferenceByNumberShared(projectId, quoteNumber, revision);
}

// 견적서 하나의 전체 리비전 목록 — 거래명세서에서 어느 리비전을 불러올지 고르게 한다.
export async function listQuoteRevisionsForStatement(
  projectId: string,
  quoteNumber: string
): Promise<QuoteRevisionSummary[]> {
  return getQuoteRevisions(projectId, quoteNumber);
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

// "다른 견적서도 함께 묶기" 후보(2026-10-19) — 한 업체가 시차를 두고 주문하면 주문마다 프로젝트가
// 따로 만들어지는 게 보통이라, 같은 고객의 다른 프로젝트 견적서도 후보에 넣는다. 검색어가 있으면
// 상호 표기가 다른 경우("인더볼(와이에스물류)" 등)도 찾을 수 있게 전체 프로젝트에서 상호/견적번호/
// 프로젝트번호로 찾는다. 견적번호별 최신 리비전만 보여준다.
export async function searchQuotesForBundle(projectId: string, query: string): Promise<BundleQuoteOption[]> {
  await requireSession();

  const [host] = await db
    .select({ customerId: projects.customerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!host) return [];

  const q = query.trim();
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      revision: quotes.revision,
      projectId: quotes.projectId,
      projectNumber: projects.projectNumber,
      customerName: quotes.customerName,
      quoteDate: quotes.quoteDate,
      compareProductName: quotes.compareProductName,
    })
    .from(quotes)
    .innerJoin(projects, eq(quotes.projectId, projects.id))
    .where(
      q
        ? or(ilike(quotes.customerName, like), ilike(quotes.quoteNumber, like), ilike(projects.projectNumber, like))
        : eq(projects.customerId, host.customerId)
    )
    .orderBy(desc(quotes.createdAt), desc(quotes.revision))
    .limit(120);
  if (rows.length === 0) return [];

  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = `${r.projectId}:${r.quoteNumber}`;
    const cur = latest.get(key);
    if (!cur || r.revision > cur.revision) latest.set(key, r);
  }
  const picked = [...latest.values()].slice(0, 30);

  const items = await db
    .select({ quoteId: quoteItems.quoteId, name: quoteItems.name, lineType: quoteItems.lineType })
    .from(quoteItems)
    .where(
      inArray(
        quoteItems.quoteId,
        picked.map((r) => r.id)
      )
    )
    .orderBy(asc(quoteItems.sortOrder));
  const countMap = new Map<string, number>();
  const productMap = new Map<string, string>();
  for (const it of items) {
    countMap.set(it.quoteId, (countMap.get(it.quoteId) ?? 0) + 1);
    if (it.lineType === "product" && !productMap.has(it.quoteId)) productMap.set(it.quoteId, it.name);
  }

  return picked.map((r) => ({
    quoteId: r.id,
    quoteNumber: r.quoteNumber,
    projectId: r.projectId,
    projectNumber: r.projectNumber,
    isSameProject: r.projectId === projectId,
    customerName: r.customerName,
    productName: r.compareProductName || productMap.get(r.id) || "",
    quoteDate: r.quoteDate ?? "",
    itemCount: countMap.get(r.id) ?? 0,
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

  // 여러 견적서를 한 장으로 묶은 거래명세서(2026-10-19)면 품목이 걸린 견적번호가 둘 이상이다 —
  // 대표 견적(quoteId)을 맨 앞에 두고 나머지를 덧붙여 화면에 "묶인 견적서"로 보여준다.
  const itemQuoteIds = itemRows.map((it) => it.quoteItemId).filter((id): id is string => !!id);
  const linkedQuoteNumbers: string[] = [];
  if (row.quoteId) {
    const [primary] = await db
      .select({ quoteNumber: quotes.quoteNumber })
      .from(quotes)
      .where(eq(quotes.id, row.quoteId))
      .limit(1);
    if (primary) linkedQuoteNumbers.push(primary.quoteNumber);
  }
  if (itemQuoteIds.length > 0) {
    const linked = await db
      .select({ quoteNumber: quotes.quoteNumber })
      .from(quoteItems)
      .innerJoin(quotes, eq(quoteItems.quoteId, quotes.id))
      .where(inArray(quoteItems.id, itemQuoteIds));
    for (const l of linked) if (!linkedQuoteNumbers.includes(l.quoteNumber)) linkedQuoteNumbers.push(l.quoteNumber);
  }

  return {
    id: row.id,
    statementNumber: row.statementNumber,
    purchaseOrderId: row.purchaseOrderId,
    quoteId: row.quoteId,
    linkedQuoteNumbers,
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

async function saveStatementImpl(projectId: string, draft: StatementDraft): Promise<{ id: string }> {
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
  await advanceLinkedProjects(created.id, projectId, "statement_sent", session.userId);

  return { id: created.id };
}

// 오타·빠진 내용 정정용 "수정 저장" — 거래명세서 번호는 그대로 두고 저장된 문서를 덮어쓴다
// (2026-10-15). 새 번호로 다시 저장하지 않아도 된다. 고객 결제/현금영수증 기록(paid_*,
// cash_receipt_issued_at)과 연결된 세금계산서는 건드리지 않는다. 품목은 기존 id를 유지한 채
// UPDATE하고 새 줄만 INSERT, 빠진 줄만 DELETE한다.
async function updateStatementImpl(projectId: string, statementId: string, draft: StatementDraft): Promise<void> {
  const session = await requireSession();

  if (!draft.customerName.trim()) throw new Error("수신 고객사를 입력해주세요.");
  if (!draft.quoteId) {
    throw new Error("거래명세서를 저장하려면 먼저 견적서를 불러와 어느 견적에 대한 건인지 선택해주세요.");
  }
  const desired = draft.items.filter((it) => it.name.trim() !== "");
  if (desired.length === 0) throw new Error("품목을 1개 이상 입력해주세요.");

  const [row] = await db
    .select({ id: transactionStatements.id })
    .from(transactionStatements)
    .where(and(eq(transactionStatements.id, statementId), eq(transactionStatements.projectId, projectId)))
    .limit(1);
  if (!row) throw new Error("거래명세서를 찾을 수 없습니다.");

  const existing = await db
    .select({ id: statementItems.id })
    .from(statementItems)
    .where(eq(statementItems.statementId, statementId));
  const existingIds = new Set(existing.map((e) => e.id));
  const keptIds = new Set(desired.map((it) => it.uid).filter((uid) => existingIds.has(uid)));
  const removedIds = existing.map((e) => e.id).filter((id) => !keptIds.has(id));

  await db.transaction(async (tx) => {
    await tx
      .update(transactionStatements)
      .set({
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
      })
      .where(eq(transactionStatements.id, statementId));

    if (removedIds.length > 0) {
      await tx.delete(statementItems).where(inArray(statementItems.id, removedIds));
    }

    for (let idx = 0; idx < desired.length; idx++) {
      const it = desired[idx];
      const values = {
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
      };
      if (existingIds.has(it.uid)) {
        await tx.update(statementItems).set(values).where(eq(statementItems.id, it.uid));
      } else {
        await tx.insert(statementItems).values({ statementId, ...values });
      }
    }
  });

  // 수정으로 다른 프로젝트의 견적서를 새로 묶었다면 그 프로젝트도 "거래명세서 발송"으로 진행시킨다.
  await advanceLinkedProjects(statementId, projectId, "statement_sent", session.userId);
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
    await advanceLinkedProjects(statementId, projectId, "tax_invoice_issued", session.userId);
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
    await advanceLinkedProjects(statementId, projectId, "tax_invoice_issued", session.userId);
  }
}

// 운영(production) 빌드에서는 서버 액션이 던진 Error의 메시지가 가려져 화면에 "Minified React error
// #441"만 나온다(2026-10-19: 이미 저장된 번호로 다시 저장했을 때 원인을 알 수 없었음). 저장/수정은
// 사용자가 고칠 수 있는 오류가 많아서(번호 중복, 단계 미도달, 필수값 누락 등) 던지지 않고 결과로
// 돌려줘 화면에 그대로 보여준다.
export type StatementActionResult = { ok: true; id: string } | { ok: false; error: string };

function toUserMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
  return raw.split(String.fromCharCode(10))[0].slice(0, 300);
}

export async function saveStatement(projectId: string, draft: StatementDraft): Promise<StatementActionResult> {
  try {
    const { id } = await saveStatementImpl(projectId, draft);
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: toUserMessage(err) };
  }
}

export async function updateStatement(
  projectId: string,
  statementId: string,
  draft: StatementDraft
): Promise<StatementActionResult> {
  try {
    await updateStatementImpl(projectId, statementId, draft);
    return { ok: true, id: statementId };
  } catch (err) {
    return { ok: false, error: toUserMessage(err) };
  }
}
