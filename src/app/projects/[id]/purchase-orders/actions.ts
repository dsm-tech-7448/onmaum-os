"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerShippingAddresses, purchaseOrders, poItems, projects, quotes, quoteItems } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { generatePoNumber } from "@/lib/purchase-orders/po-number";
import { advanceProjectStage, assertProjectReachedStage } from "@/lib/projects/stage-transition";
import {
  getQuoteReferenceById as getQuoteReferenceByIdShared,
  getQuoteReferenceByNumber as getQuoteReferenceByNumberShared,
  searchProjectQuotes,
} from "@/app/projects/[id]/quotes/actions";
import type {
  PoDraft,
  PoItemDraft,
  PoRevisionSummary,
  PoSearchResult,
  ShippingInfo,
} from "@/lib/purchase-orders/types";
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

// 한 견적의 품목별로 공급업체가 다른 경우(예: 상품은 A사, 인쇄는 B사)를 위해, 품목
// 체크박스를 여러 번 나눠서 각각 다른 공급업체로 발주서를 따로 작성할 수 있다
// (2026-09-15, [[project_po_multi_item_select]]). 그런데 지금까지는 이미 다른
// 발주서에 들어간 품목인지 화면에 전혀 표시가 안 돼서, 품목을 나눠 발주할 때 뭐가
// 이미 발주됐는지 헷갈렸다(2026-10-02 피드백). 이 견적에 대해 이미 (최신 리비전)
// 발주서에 들어간 품목의 quote_item_id를 모아 돌려준다 — 체크박스 목록에 "✅ 발주됨"
// 표시용. 금액 계산엔 안 쓰이는 화면 힌트용이라, po_items에 quote_item_id가 없는
// 단일 품목 발주서는 purchase_orders.quote_item_id로도 보완해서 잡는다.
export async function getOrderedQuoteItemIds(projectId: string, quoteId: string): Promise<string[]> {
  await requireSession();

  const allPos = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      revision: purchaseOrders.revision,
      quoteItemId: purchaseOrders.quoteItemId,
    })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.projectId, projectId), eq(purchaseOrders.quoteId, quoteId)));
  if (allPos.length === 0) return [];

  const latestByNumber = new Map<string, (typeof allPos)[number]>();
  for (const po of allPos) {
    const existing = latestByNumber.get(po.poNumber);
    if (!existing || po.revision > existing.revision) latestByNumber.set(po.poNumber, po);
  }
  const latestPos = [...latestByNumber.values()];
  const poIds = latestPos.map((p) => p.id);

  const items = poIds.length
    ? await db.select({ quoteItemId: poItems.quoteItemId }).from(poItems).where(inArray(poItems.poId, poIds))
    : [];

  const ids = new Set<string>();
  for (const po of latestPos) if (po.quoteItemId) ids.add(po.quoteItemId);
  for (const it of items) if (it.quoteItemId) ids.add(it.quoteItemId);
  return [...ids];
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
    supplyOverride: row.supplyOverride ?? "",
    quoteItemId: row.quoteItemId,
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

// 고객별 배송지 기준정보(2026-10-12) — 발주서에 적은 배송 주소/수령자를 프로젝트의 고객사
// 단위로 쌓아두고, 다음 발주서 작성 시 골라 쓰거나 새로 입력할 수 있게 한다.
// 최근에 쓴 배송지가 위로 오도록 정렬한다.
export async function listCustomerShippingInfos(projectId: string): Promise<ShippingInfo[]> {
  await requireSession();

  const [project] = await db
    .select({ customerId: projects.customerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return [];

  const rows = await db
    .select()
    .from(customerShippingAddresses)
    .where(eq(customerShippingAddresses.customerId, project.customerId))
    .orderBy(desc(customerShippingAddresses.lastUsedAt));

  return rows.map((r) => ({
    id: r.id,
    address: r.address,
    receiver: r.receiver,
    useCount: r.useCount,
    lastUsedAt: r.lastUsedAt.toISOString(),
  }));
}

// 잘못 저장했거나 더 안 쓰는 배송지를 기준정보에서 지운다. 이미 작성된 발주서의 배송
// 정보는 발주서 자체에 값으로 남아 있어 영향이 없다. 다른 고객의 것을 지우지 못하게
// 이 프로젝트의 고객 소유인지 함께 확인한다.
export async function deleteCustomerShippingInfo(projectId: string, shippingInfoId: string): Promise<void> {
  await requireSession();

  const [project] = await db
    .select({ customerId: projects.customerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");

  await db
    .delete(customerShippingAddresses)
    .where(
      and(
        eq(customerShippingAddresses.id, shippingInfoId),
        eq(customerShippingAddresses.customerId, project.customerId)
      )
    );
}

async function upsertCustomerShippingInfo(customerId: string, rawAddress: string, rawReceiver: string) {
  const address = rawAddress.trim();
  const receiver = rawReceiver.trim();
  if (!address) return;

  await db
    .insert(customerShippingAddresses)
    .values({ customerId, address, receiver })
    .onConflictDoUpdate({
      target: [
        customerShippingAddresses.customerId,
        customerShippingAddresses.address,
        customerShippingAddresses.receiver,
      ],
      set: {
        useCount: sql`${customerShippingAddresses.useCount} + 1`,
        lastUsedAt: sql`now()`,
      },
    });
}

// 오타·빠진 내용 정정용 "수정 저장" — 새 리비전을 만들지 않고 지금 불러온 리비전을 그대로
// 고친다(2026-10-15). 발주번호/리비전 번호는 유지하고, 입금 기록(paid_*)은 건드리지 않는다.
// 품목은 기존 id를 유지한 채 UPDATE하고 새 줄만 INSERT, 빠진 줄만 DELETE한다.
export async function updatePO(projectId: string, poId: string, draft: PoDraft): Promise<{ revision: number }> {
  await requireSession();

  if (!draft.supplierName.trim()) throw new Error("공급자(협력업체)를 입력해주세요.");
  if (!draft.quoteId) {
    throw new Error("발주서를 저장하려면 먼저 견적서를 불러와 어느 견적에 대한 발주인지 선택해주세요.");
  }

  const [po] = await db
    .select({ id: purchaseOrders.id, revision: purchaseOrders.revision })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.projectId, projectId)))
    .limit(1);
  if (!po) throw new Error("발주서를 찾을 수 없습니다.");

  const [project] = await db
    .select({ customerId: projects.customerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const existing = await db.select({ id: poItems.id }).from(poItems).where(eq(poItems.poId, poId));
  const existingIds = new Set(existing.map((e) => e.id));
  const desired = (await autoLinkQuoteItems(draft.quoteId, draft.items)).filter((it) => it.name.trim() !== "");
  const keptIds = new Set(desired.map((it) => it.uid).filter((uid) => existingIds.has(uid)));
  const removedIds = existing.map((e) => e.id).filter((id) => !keptIds.has(id));

  await db.transaction(async (tx) => {
    await tx
      .update(purchaseOrders)
      .set({
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
      })
      .where(eq(purchaseOrders.id, poId));

    if (removedIds.length > 0) {
      await tx.delete(poItems).where(inArray(poItems.id, removedIds));
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
        await tx.update(poItems).set(values).where(eq(poItems.id, it.uid));
      } else {
        await tx.insert(poItems).values({ poId, ...values });
      }
    }
  });

  // 수정 중 새로 적은 배송지가 있으면 기준정보에 추가만 한다(사용횟수는 올리지 않음).
  if (project && draft.shipAddr.trim()) {
    try {
      await db
        .insert(customerShippingAddresses)
        .values({ customerId: project.customerId, address: draft.shipAddr.trim(), receiver: draft.shipReceiver.trim() })
        .onConflictDoNothing();
    } catch (err) {
      console.error("배송지 기준정보 저장 실패", err);
    }
  }

  return { revision: po.revision };
}

// 견적 품목 연결 자동 보정(2026-10-23) — 발주서 품목을 "견적 품목 선택" 없이 직접 타이핑하면
// po_items.quote_item_id가 비어 Summary에서 견적 정보가 없는 별도 발주서 행으로 뜬다. 저장할 때 연결된
// 견적(quoteId)의 품목 중 이름이 정확히 하나만 일치하는 품목(product) 줄은 그 품목으로 이어준다
// (발주서가 품목 1줄이고 견적 품목도 1개면 이름이 달라도). 애매하면 비워둔다.
async function autoLinkQuoteItems(quoteId: string, items: PoItemDraft[]): Promise<PoItemDraft[]> {
  const unlinked = items.filter((it) => it.lineType === "product" && !it.quoteItemId && it.name.trim() !== "");
  if (unlinked.length === 0) return items;

  const candidates = await db
    .select({ id: quoteItems.id, name: quoteItems.name })
    .from(quoteItems)
    .where(and(eq(quoteItems.quoteId, quoteId), eq(quoteItems.lineType, "product")));
  const productLineCount = items.filter((it) => it.lineType === "product" && it.name.trim() !== "").length;

  return items.map((it) => {
    if (it.lineType !== "product" || it.quoteItemId || it.name.trim() === "") return it;
    const exact = candidates.filter((c) => c.name.trim() === it.name.trim());
    if (exact.length === 1) return { ...it, quoteItemId: exact[0].id };
    if (productLineCount === 1 && candidates.length === 1) return { ...it, quoteItemId: candidates[0].id };
    return it;
  });
}

export type SavePoResult = { revision: number; id: string; poDate: string };

export async function savePO(
  projectId: string,
  draft: PoDraft,
  saveShippingInfo = true
): Promise<SavePoResult> {
  const session = await requireSession();

  const poNumber = draft.poNumber.trim();
  if (!poNumber) throw new Error("발주번호를 입력해주세요.");
  if (!draft.supplierName.trim()) throw new Error("공급자(협력업체)를 입력해주세요.");
  if (!draft.quoteId) {
    throw new Error("발주서를 저장하려면 먼저 견적서를 불러와 어느 견적에 대한 발주인지 선택해주세요.");
  }

  const [project] = await db
    .select({ requiresDraft: projects.requiresDraft, customerId: projects.customerId })
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

  // 발주일자 = 이 리비전을 저장한 날(견적서와 동일, 2026-10-30 요청: 모든 문서는 리비전한 날짜를 적용).
  // 날짜를 직접 정해야 하면 "수정 저장"(updatePO)은 입력한 날짜를 그대로 둔다.
  const poDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

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
      poDate,
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

  const itemsToInsert = (await autoLinkQuoteItems(draft.quoteId, draft.items))
    .filter((it) => it.name.trim() !== "")
    .map((it, idx) => ({
      poId: created.id,
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

  if (itemsToInsert.length > 0) {
    await db.insert(poItems).values(itemsToInsert);
  }

  await advanceProjectStage(projectId, "supplier_ordered", session.userId);

  // 기준정보 저장 실패가 이미 저장된 발주서를 실패처럼 보이게 하면 안 되므로 따로 격리한다.
  if (saveShippingInfo) {
    try {
      await upsertCustomerShippingInfo(project.customerId, draft.shipAddr, draft.shipReceiver);
    } catch (err) {
      console.error("배송지 기준정보 저장 실패", err);
    }
  }

  return { revision: nextRevision, id: created.id, poDate };
}
