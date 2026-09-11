"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { purchaseOrders, poItems, projects, quotes } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { generatePoNumber } from "@/lib/purchase-orders/po-number";
import { advanceProjectStage, assertProjectReachedStage } from "@/lib/projects/stage-transition";
import {
  getQuoteReferenceById as getQuoteReferenceByIdShared,
  getQuoteReferenceByNumber as getQuoteReferenceByNumberShared,
  searchProjectQuotes,
} from "@/app/projects/[id]/quotes/actions";
import type { PoDraft, PoItemDraft, PoRevisionSummary, PoSearchResult } from "@/lib/purchase-orders/types";
import type { QuoteReferenceSummary, QuoteSearchResult } from "@/lib/quotes/types";

async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  return session;
}

export async function searchQuotesForPoLink(projectId: string, query: string): Promise<QuoteSearchResult[]> {
  return searchProjectQuotes(projectId, query);
}

// 견적 요약 조회 로직은 quotes/actions.ts에 있고(drafts와 공유), "use server" 파일은
// 재-export가 아닌 실제 async 함수 선언만 허용하므로 얇게 감싼다.
export async function getQuoteReferenceById(quoteId: string): Promise<QuoteReferenceSummary | null> {
  return getQuoteReferenceByIdShared(quoteId);
}

export async function getQuoteReferenceByNumber(
  projectId: string,
  quoteNumber: string
): Promise<QuoteReferenceSummary | null> {
  return getQuoteReferenceByNumberShared(projectId, quoteNumber);
}

// 페이지를 열었을 때 기본으로 보여줄 견적 — 이 프로젝트에서 가장 최근에 저장한 발주가
// 연결해둔 견적을 그대로 보여준다. 발주가 아직 하나도 없으면 아무것도 자동으로 고르지
// 않고, 사용자가 직접 "저장된 견적 찾기"에서 불러와야 한다(자동 추정 금지).
export async function getInitialPoQuoteReference(projectId: string): Promise<QuoteReferenceSummary | null> {
  await requireSession();

  const [latestPo] = await db
    .select({ quoteId: purchaseOrders.quoteId })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.projectId, projectId))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(1);

  if (!latestPo?.quoteId) return null;
  return getQuoteReferenceById(latestPo.quoteId);
}

export async function generateNewPoNumber(): Promise<string> {
  await requireSession();
  return generatePoNumber();
}

export async function searchProjectPOs(projectId: string, query: string): Promise<PoSearchResult[]> {
  await requireSession();

  const rows = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      revision: purchaseOrders.revision,
      supplierName: purchaseOrders.supplierName,
      poDate: purchaseOrders.poDate,
      createdAt: purchaseOrders.createdAt,
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

  const q = query.trim().toLowerCase();
  return Array.from(latestByNumber.values())
    .filter(
      (r) => !q || r.poNumber.toLowerCase().includes(q) || r.supplierName.toLowerCase().includes(q)
    )
    .sort((a, b) => b.poNumber.localeCompare(a.poNumber))
    .map((r) => ({
      poNumber: r.poNumber,
      latestRevision: r.revision,
      supplierName: r.supplierName,
      poDate: r.poDate,
      itemCount: countMap.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
    }));
}

export async function getPoRevisions(projectId: string, poNumber: string): Promise<PoRevisionSummary[]> {
  await requireSession();
  if (!poNumber.trim()) return [];

  const rows = await db
    .select({
      id: purchaseOrders.id,
      revision: purchaseOrders.revision,
      createdAt: purchaseOrders.createdAt,
      quoteNumber: quotes.quoteNumber,
    })
    .from(purchaseOrders)
    .leftJoin(quotes, eq(purchaseOrders.quoteId, quotes.id))
    .where(and(eq(purchaseOrders.projectId, projectId), eq(purchaseOrders.poNumber, poNumber)))
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

  return rows.map((r) => ({
    revision: r.revision,
    createdAt: r.createdAt.toISOString(),
    itemCount: countMap.get(r.id) ?? 0,
    quoteNumber: r.quoteNumber,
  }));
}

function toItemDraft(row: typeof poItems.$inferSelect): PoItemDraft {
  return {
    uid: row.id,
    lineType: row.lineType === "product" ? "product" : "option",
    code: row.code ?? "",
    name: row.name,
    spec: row.spec ?? "",
    unit: row.unit ?? "개",
    qty: row.qty ?? "",
    price: row.price ?? "",
  };
}

export async function loadPoRevision(
  projectId: string,
  poNumber: string,
  revision?: number
): Promise<PoDraft | null> {
  await requireSession();

  const conditions = [eq(purchaseOrders.projectId, projectId), eq(purchaseOrders.poNumber, poNumber)];
  if (revision != null) conditions.push(eq(purchaseOrders.revision, revision));

  const [poRow] = await db
    .select()
    .from(purchaseOrders)
    .where(and(...conditions))
    .orderBy(desc(purchaseOrders.revision))
    .limit(1);

  if (!poRow) return null;

  const itemRows = await db.select().from(poItems).where(eq(poItems.poId, poRow.id)).orderBy(poItems.sortOrder);

  return {
    id: poRow.id,
    poNumber: poRow.poNumber,
    quoteId: poRow.quoteId,
    quoteItemId: poRow.quoteItemId,
    supplierId: poRow.supplierId,
    supplierName: poRow.supplierName,
    supplierPhone: poRow.supplierPhone ?? "",
    receiver: poRow.receiver ?? "",
    poDate: poRow.poDate,
    reqDate: poRow.reqDate ?? "",
    payTerm: poRow.payTerm ?? "",
    printNote: poRow.printNote ?? "",
    shipAddr: poRow.shipAddr ?? "",
    shipReceiver: poRow.shipReceiver ?? "",
    note: poRow.note ?? "",
    requestNote: poRow.requestNote ?? "",
    paidAmount: poRow.paidAmount ?? "",
    paidDate: poRow.paidDate ?? "",
    items: itemRows.map(toItemDraft),
  };
}

// 공급업체 입금 기록 — 새 리비전을 만들지 않고 해당 리비전 행을 그대로 UPDATE한다
// (입금은 발주 확정 후 벌어지는 별개 이벤트라 문서 이력에 영향을 주지 않는다).
export async function recordSupplierPayment(
  projectId: string,
  poId: string,
  paidAmount: string,
  paidDate: string
): Promise<void> {
  await requireSession();

  const [po] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.projectId, projectId)))
    .limit(1);
  if (!po) throw new Error("발주서를 찾을 수 없습니다.");

  await db
    .update(purchaseOrders)
    .set({
      paidAmount: paidAmount.trim() || null,
      paidDate: paidDate.trim() || null,
    })
    .where(eq(purchaseOrders.id, poId));
}

// 발송요청일 수정 — 공급업체 사정으로 협의 후 날짜가 바뀌는 경우가 실제로 있어, 새
// 리비전을 만들지 않고 해당 리비전 행의 발송요청일만 바로 고칠 수 있게 한다.
export async function updateReqDate(projectId: string, poId: string, reqDate: string): Promise<void> {
  await requireSession();

  const [po] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.projectId, projectId)))
    .limit(1);
  if (!po) throw new Error("발주서를 찾을 수 없습니다.");

  await db
    .update(purchaseOrders)
    .set({ reqDate: reqDate.trim() || null })
    .where(eq(purchaseOrders.id, poId));
}

export type SavePoResult = { revision: number; id: string };

export async function savePO(projectId: string, draft: PoDraft): Promise<SavePoResult> {
  const session = await requireSession();

  const poNumber = draft.poNumber.trim();
  if (!poNumber) throw new Error("발주번호를 입력해주세요.");
  if (!draft.supplierName.trim()) throw new Error("공급자(협력업체)를 입력해주세요.");
  if (!draft.quoteId) {
    throw new Error("발주서를 저장하려면 먼저 견적서를 불러와 어느 견적에 대한 발주인지 선택해주세요.");
  }

  const [project] = await db
    .select({ requiresDraft: projects.requiresDraft })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");

  // 견적을 거치지 않고 발주부터 만드는 경우는 없다 — requires_draft에 따라
  // 인쇄 시안 작성(3) 또는 견적 발송(2) 이후에만 발주 저장을 허용한다.
  // 고객의 시안 확정은 이메일/문자로 별도 전달되고 앱에 입력하지 않으므로,
  // "고객 시안 확정"(4) 단계까지 기다리지 않고 시안을 작성만 해도 발주서를 작성할 수 있다.
  await assertProjectReachedStage(projectId, project.requiresDraft ? "draft_wip" : "quote");

  const [{ maxRevision }] = await db
    .select({ maxRevision: sql<number | null>`max(${purchaseOrders.revision})` })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.projectId, projectId), eq(purchaseOrders.poNumber, poNumber)));

  const nextRevision = (maxRevision ?? 0) + 1;

  const [created] = await db
    .insert(purchaseOrders)
    .values({
      projectId,
      poNumber,
      revision: nextRevision,
      quoteId: draft.quoteId,
      quoteItemId: draft.quoteItemId,
      supplierId: draft.supplierId,
      supplierName: draft.supplierName.trim(),
      supplierPhone: draft.supplierPhone || null,
      receiver: draft.receiver || null,
      poDate: draft.poDate,
      reqDate: draft.reqDate || null,
      payTerm: draft.payTerm || null,
      printNote: draft.printNote || null,
      shipAddr: draft.shipAddr || null,
      shipReceiver: draft.shipReceiver || null,
      note: draft.note || null,
      requestNote: draft.requestNote || null,
      createdBy: session.userId,
    })
    .returning({ id: purchaseOrders.id });

  const itemsToInsert = draft.items
    .filter((it) => it.name.trim() !== "")
    .map((it, idx) => ({
      poId: created.id,
      lineType: it.lineType,
      code: it.code || null,
      name: it.name.trim(),
      spec: it.spec || null,
      unit: it.unit || "개",
      qty: it.qty || null,
      price: it.price || null,
      sortOrder: idx,
    }));

  if (itemsToInsert.length > 0) {
    await db.insert(poItems).values(itemsToInsert);
  }

  await advanceProjectStage(projectId, "supplier_ordered", session.userId);

  return { revision: nextRevision, id: created.id };
}
