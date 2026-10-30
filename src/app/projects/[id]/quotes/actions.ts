"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  quotes,
  quoteTiers,
  quoteItems,
  optionMaster,
  productSuggestions,
  drafts,
  purchaseOrders,
  poItems,
  transactionStatements,
  statementItems,
  summaryOverrides,
  projectRequests,
} from "@/db/schema";
import { getSession, requireAdmin } from "@/lib/auth/session";
import { recordDeletion } from "@/lib/audit/deletion-log";
import { syncProjectCustomerWithQuote } from "@/lib/projects/sync-customer";
import { generateQuoteNumber } from "@/lib/quotes/quote-number";
import { advanceProjectStage } from "@/lib/projects/stage-transition";
import type {
  QuoteDraft,
  QuoteItemDraft,
  QuoteReferenceSummary,
  QuoteRevisionSummary,
  QuoteSearchResult,
} from "@/lib/quotes/types";

async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  return session;
}

// 나중에 견적서를 찾을 때 도움이 되도록 리비전 이력/검색 목록에도 상품명을 보여준다.
// compare 모드는 quotes.compare_product_name에 이미 있고, single/multiple은 quote_items 중
// line_type='product'인 첫 줄(sort_order 최소)을 상품명으로 쓴다 — PNG 파일명과 같은 규칙.
async function getProductNames(
  quoteIds: string[],
  compareNames: Map<string, string | null>
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (quoteIds.length === 0) return result;

  const itemRows = await db
    .select({
      quoteId: quoteItems.quoteId,
      name: quoteItems.name,
      lineType: quoteItems.lineType,
      sortOrder: quoteItems.sortOrder,
    })
    .from(quoteItems)
    .where(and(inArray(quoteItems.quoteId, quoteIds), sql`${quoteItems.tierId} is null`))
    .orderBy(quoteItems.sortOrder);

  const firstProduct = new Map<string, string>();
  const firstAny = new Map<string, string>();
  for (const row of itemRows) {
    if (!firstAny.has(row.quoteId)) firstAny.set(row.quoteId, row.name);
    if (row.lineType === "product" && !firstProduct.has(row.quoteId)) {
      firstProduct.set(row.quoteId, row.name);
    }
  }

  for (const id of quoteIds) {
    const compareName = compareNames.get(id);
    result.set(id, (compareName && compareName.trim()) || firstProduct.get(id) || firstAny.get(id) || "");
  }
  return result;
}

export async function generateNewQuoteNumber(): Promise<string> {
  await requireSession();
  return generateQuoteNumber();
}

export async function searchProjectQuotes(
  projectId: string,
  query: string
): Promise<QuoteSearchResult[]> {
  await requireSession();

  const rows = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      revision: quotes.revision,
      customerName: quotes.customerName,
      quoteDate: quotes.quoteDate,
      createdAt: quotes.createdAt,
      compareProductName: quotes.compareProductName,
    })
    .from(quotes)
    .where(eq(quotes.projectId, projectId))
    .orderBy(desc(quotes.revision));

  if (rows.length === 0) return [];

  const itemCounts = await db
    .select({ quoteId: quoteItems.quoteId, count: sql<number>`count(*)::int` })
    .from(quoteItems)
    .where(
      inArray(
        quoteItems.quoteId,
        rows.map((r) => r.id)
      )
    )
    .groupBy(quoteItems.quoteId);
  const countMap = new Map(itemCounts.map((c) => [c.quoteId, c.count]));

  const latestByNumber = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestByNumber.has(row.quoteNumber)) latestByNumber.set(row.quoteNumber, row);
  }

  const latestRows = Array.from(latestByNumber.values());
  const productNames = await getProductNames(
    latestRows.map((r) => r.id),
    new Map(latestRows.map((r) => [r.id, r.compareProductName]))
  );

  const q = query.trim().toLowerCase();
  return latestRows
    .filter(
      (r) =>
        !q ||
        r.quoteNumber.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        (productNames.get(r.id) ?? "").toLowerCase().includes(q)
    )
    .sort((a, b) => b.quoteNumber.localeCompare(a.quoteNumber))
    .map((r) => ({
      quoteNumber: r.quoteNumber,
      latestRevision: r.revision,
      customerName: r.customerName,
      quoteDate: r.quoteDate ?? "",
      itemCount: countMap.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
      productName: productNames.get(r.id) ?? "",
    }));
}

export async function getQuoteRevisions(
  projectId: string,
  quoteNumber: string
): Promise<QuoteRevisionSummary[]> {
  await requireSession();
  if (!quoteNumber.trim()) return [];

  const rows = await db
    .select({
      id: quotes.id,
      revision: quotes.revision,
      createdAt: quotes.createdAt,
      compareProductName: quotes.compareProductName,
    })
    .from(quotes)
    .where(and(eq(quotes.projectId, projectId), eq(quotes.quoteNumber, quoteNumber)))
    .orderBy(desc(quotes.revision));

  if (rows.length === 0) return [];

  const itemCounts = await db
    .select({ quoteId: quoteItems.quoteId, count: sql<number>`count(*)::int` })
    .from(quoteItems)
    .where(
      inArray(
        quoteItems.quoteId,
        rows.map((r) => r.id)
      )
    )
    .groupBy(quoteItems.quoteId);
  const countMap = new Map(itemCounts.map((c) => [c.quoteId, c.count]));

  const productNames = await getProductNames(
    rows.map((r) => r.id),
    new Map(rows.map((r) => [r.id, r.compareProductName]))
  );

  return rows.map((r) => ({
    revision: r.revision,
    createdAt: r.createdAt.toISOString(),
    itemCount: countMap.get(r.id) ?? 0,
    productName: productNames.get(r.id) ?? "",
  }));
}

function toItemDraft(row: typeof quoteItems.$inferSelect): QuoteItemDraft {
  return {
    uid: row.id,
    lineType: row.lineType === "product" ? "product" : "option",
    code: row.code ?? "",
    name: row.name,
    spec: row.spec ?? "",
    unit: row.unit ?? "개",
    qty: row.qty ?? "",
    price: row.price ?? "",
    imageDataUrl: row.imageDataUrl ?? "",
    altCode: row.altCode ?? "",
    supplyOverride: row.supplyOverride ?? "",
  };
}

export async function loadQuoteRevision(
  projectId: string,
  quoteNumber: string,
  revision?: number
): Promise<QuoteDraft | null> {
  await requireSession();

  const conditions = [eq(quotes.projectId, projectId), eq(quotes.quoteNumber, quoteNumber)];
  if (revision != null) conditions.push(eq(quotes.revision, revision));

  const [quoteRow] = await db
    .select()
    .from(quotes)
    .where(and(...conditions))
    .orderBy(desc(quotes.revision))
    .limit(1);

  if (!quoteRow) return null;

  const [tierRows, itemRows] = await Promise.all([
    db.select().from(quoteTiers).where(eq(quoteTiers.quoteId, quoteRow.id)).orderBy(quoteTiers.sortOrder),
    db.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteRow.id)).orderBy(quoteItems.sortOrder),
  ]);

  const tiers = tierRows.map((t) => ({
    uid: t.id,
    items: itemRows.filter((it) => it.tierId === t.id).map(toItemDraft),
  }));
  const items = itemRows.filter((it) => it.tierId === null).map(toItemDraft);

  return {
    id: quoteRow.id,
    quoteNumber: quoteRow.quoteNumber,
    mode: quoteRow.mode as QuoteDraft["mode"],
    customerName: quoteRow.customerName,
    contactName: quoteRow.contactName ?? "",
    contactPhone: quoteRow.contactPhone ?? "",
    quoteDate: quoteRow.quoteDate ?? "",
    validity: quoteRow.validity ?? "",
    confirmText: quoteRow.confirmText ?? "",
    mainImageDataUrl: quoteRow.mainImageDataUrl,
    compareProductCode: quoteRow.compareProductCode ?? "",
    compareProductName: quoteRow.compareProductName ?? "",
    compareProductSpec: quoteRow.compareProductSpec ?? "",
    adjustmentLabel: quoteRow.adjustmentLabel ?? "절삭",
    adjustmentAmount: quoteRow.adjustmentAmount ?? "",
    items,
    tiers,
  };
}

export type SaveQuoteResult = {
  id: string;
  revision: number;
  createdAt: string;
  quoteDate: string; // 실제로 저장된 견적일자("" = 표시 안 함) — 화면 미리보기를 맞추는 데 쓴다
};

async function accumulateMasters(allItems: QuoteItemDraft[]) {
  const productNames = new Set<string>();
  const optionNames = new Set<string>();

  for (const it of allItems) {
    const name = it.name.trim();
    if (!name) continue;
    if (it.lineType === "product") productNames.add(name);
    else optionNames.add(name);
  }

  for (const name of productNames) {
    await db
      .insert(productSuggestions)
      .values({ name, usageCount: 1 })
      .onConflictDoUpdate({
        target: productSuggestions.name,
        set: { usageCount: sql`${productSuggestions.usageCount} + 1` },
      });
  }

  for (const name of optionNames) {
    await db
      .insert(optionMaster)
      .values({ name, usageCount: 1 })
      .onConflictDoUpdate({
        target: optionMaster.name,
        set: { usageCount: sql`${optionMaster.usageCount} + 1` },
      });
  }
}

export async function saveQuote(
  projectId: string,
  draft: QuoteDraft
): Promise<SaveQuoteResult> {
  const session = await requireSession();

  const quoteNumber = draft.quoteNumber.trim();
  if (!quoteNumber) throw new Error("견적번호를 입력해주세요.");
  // 고객사명/담당자는 견적 요청 시점에 아직 확보되지 않은 경우도 있어 선택 입력이다.

  const [{ maxRevision }] = await db
    .select({ maxRevision: sql<number | null>`max(${quotes.revision})` })
    .from(quotes)
    .where(and(eq(quotes.projectId, projectId), eq(quotes.quoteNumber, quoteNumber)));

  const nextRevision = (maxRevision ?? 0) + 1;

  // 견적일자 = 이 리비전을 저장한 날(2026-10-30 요청: "이전에 제출한 견적서인데 최근 날짜로 바꿔 달라는
  // 경우가 있다"). 새 리비전을 저장하면 날짜 표시가 켜져 있는 한 오늘 날짜(한국 시간)로 자동 갱신된다.
  // 날짜를 직접 정해야 하면 "수정 저장"(updateQuote)은 입력한 날짜를 그대로 둔다.
  const quoteDate = draft.quoteDate ? new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) : "";

  const [created] = await db
    .insert(quotes)
    .values({
      projectId,
      quoteNumber,
      revision: nextRevision,
      mode: draft.mode,
      customerName: draft.customerName.trim(),
      contactName: draft.contactName.trim() || null,
      contactPhone: draft.contactPhone.trim() || null,
      quoteDate: quoteDate || null,
      validity: draft.validity || null,
      confirmText: draft.confirmText || null,
      mainImageDataUrl: draft.mainImageDataUrl,
      compareProductCode: draft.compareProductCode || null,
      compareProductName: draft.compareProductName || null,
      compareProductSpec: draft.compareProductSpec || null,
      adjustmentLabel: draft.adjustmentAmount.trim() ? draft.adjustmentLabel.trim() || "절삭" : null,
      adjustmentAmount: draft.adjustmentAmount.trim() || null,
      createdBy: session.userId,
    })
    .returning({ id: quotes.id, createdAt: quotes.createdAt });

  const allItems: QuoteItemDraft[] = [];

  if (draft.mode === "compare") {
    for (let ti = 0; ti < draft.tiers.length; ti++) {
      const tier = draft.tiers[ti];
      const [tierRow] = await db
        .insert(quoteTiers)
        .values({ quoteId: created.id, sortOrder: ti })
        .returning({ id: quoteTiers.id });

      const itemsToInsert = tier.items
        .filter((it) => it.name.trim() !== "")
        .map((it, idx) => ({
          quoteId: created.id,
          tierId: tierRow.id,
          lineType: it.lineType,
          code: it.code || null,
          altCode: it.altCode?.trim() || null,
          name: it.name.trim(),
          spec: it.spec || null,
          unit: it.unit || "개",
          qty: it.qty || null,
          price: it.price || null,
          supplyOverride: it.supplyOverride || null,
          sortOrder: idx,
          imageDataUrl: it.imageDataUrl || null,
        }));

      if (itemsToInsert.length > 0) {
        await db.insert(quoteItems).values(itemsToInsert);
      }
      allItems.push(...tier.items);
    }
  } else {
    const itemsToInsert = draft.items
      .filter((it) => it.name.trim() !== "")
      .map((it, idx) => ({
        quoteId: created.id,
        tierId: null,
        lineType: it.lineType,
        code: it.code || null,
        altCode: it.altCode?.trim() || null,
        name: it.name.trim(),
        spec: it.spec || null,
        unit: it.unit || "개",
        qty: it.qty || null,
        price: it.price || null,
        supplyOverride: it.supplyOverride || null,
        sortOrder: idx,
        imageDataUrl: it.imageDataUrl || null,
      }));

    if (itemsToInsert.length > 0) {
      await db.insert(quoteItems).values(itemsToInsert);
    }
    allItems.push(...draft.items);
  }

  await accumulateMasters(allItems);

  // 견적을 처음 저장하면(= 아직 "견적 발송" 단계에 도달하지 않았으면) 단계를 전환한다.
  // 이미 도달했으면 리비전을 몇 번을 더 저장해도 멱등하게 아무 일도 일어나지 않는다.
  await advanceProjectStage(projectId, "quote", session.userId);

  // 나중에 알게 된 고객사명을 견적서에 입력하면 프로젝트 제목(고객사)도 함께 따라가게 한다.
  await syncProjectCustomerWithQuote(projectId, quoteNumber, draft.customerName);

  return { id: created.id, revision: nextRevision, createdAt: created.createdAt.toISOString(), quoteDate };
}

// 오타·빠진 내용 정정용 "수정 저장" — 새 리비전을 만들지 않고 지금 불러온 리비전을 그대로
// 고친다(2026-10-15 피드백: 단순 오타 수정에도 리비전이 올라가 이력이 어지러워짐). 견적번호와
// 리비전 번호는 그대로 둔다. 발주서/거래명세서/Summary가 견적 품목 id로 연결돼 있어서 품목 행을
// 지웠다 다시 만들지 않고 기존 id를 유지한 채 UPDATE하고, 새로 추가된 줄만 INSERT, 빠진 줄만
// DELETE한다 — 이미 발주서/거래명세서에 연결된 품목은 지울 수 없다.
export async function updateQuote(
  projectId: string,
  quoteId: string,
  draft: QuoteDraft
): Promise<{ id: string; revision: number }> {
  await requireSession();

  const [quote] = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.projectId, projectId)))
    .limit(1);
  if (!quote) throw new Error("견적서를 찾을 수 없습니다.");

  const [existingTiers, existingItems] = await Promise.all([
    db.select({ id: quoteTiers.id }).from(quoteTiers).where(eq(quoteTiers.quoteId, quoteId)),
    db.select({ id: quoteItems.id, name: quoteItems.name }).from(quoteItems).where(eq(quoteItems.quoteId, quoteId)),
  ]);
  const existingTierIds = new Set(existingTiers.map((t) => t.id));
  const existingItemIds = new Set(existingItems.map((i) => i.id));

  const desired: { tierUid: string | null; it: QuoteItemDraft }[] = (
    draft.mode === "compare"
      ? draft.tiers.flatMap((t) => t.items.map((it) => ({ tierUid: t.uid, it })))
      : draft.items.map((it) => ({ tierUid: null, it }))
  ).filter((row) => row.it.name.trim() !== "");

  const keptItemIds = new Set(desired.map((d) => d.it.uid).filter((uid) => existingItemIds.has(uid)));
  const removedItems = existingItems.filter((i) => !keptItemIds.has(i.id));

  if (removedItems.length > 0) {
    const removedIds = removedItems.map((i) => i.id);
    const [po, st, poi] = await Promise.all([
      db.select({ id: purchaseOrders.quoteItemId }).from(purchaseOrders).where(inArray(purchaseOrders.quoteItemId, removedIds)),
      db.select({ id: statementItems.quoteItemId }).from(statementItems).where(inArray(statementItems.quoteItemId, removedIds)),
      db.select({ id: poItems.quoteItemId }).from(poItems).where(inArray(poItems.quoteItemId, removedIds)),
    ]);
    const linked = new Set([...po, ...st, ...poi].map((r) => r.id).filter((id): id is string => !!id));
    if (linked.size > 0) {
      const names = removedItems.filter((i) => linked.has(i.id)).map((i) => `"${i.name}"`);
      throw new Error(
        `이미 발주서/거래명세서에 연결된 품목은 삭제할 수 없습니다: ${names.join(", ")}. 해당 줄을 되살리거나, 필요하면 새 리비전으로 저장해주세요.`
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(quotes)
      .set({
        mode: draft.mode,
        customerName: draft.customerName.trim(),
        contactName: draft.contactName.trim() || null,
        contactPhone: draft.contactPhone.trim() || null,
        quoteDate: draft.quoteDate || null,
        validity: draft.validity || null,
        confirmText: draft.confirmText || null,
        mainImageDataUrl: draft.mainImageDataUrl,
        compareProductCode: draft.compareProductCode || null,
        compareProductName: draft.compareProductName || null,
        compareProductSpec: draft.compareProductSpec || null,
        adjustmentLabel: draft.adjustmentAmount.trim() ? draft.adjustmentLabel.trim() || "절삭" : null,
        adjustmentAmount: draft.adjustmentAmount.trim() || null,
      })
      .where(eq(quotes.id, quoteId));

    if (removedItems.length > 0) {
      await tx.delete(quoteItems).where(inArray(quoteItems.id, removedItems.map((i) => i.id)));
    }

    // 비교견적 구간: 기존 구간은 id를 유지하고 순서만 갱신, 새 구간은 INSERT.
    const tierIdByUid = new Map<string, string>();
    if (draft.mode === "compare") {
      for (let ti = 0; ti < draft.tiers.length; ti++) {
        const tier = draft.tiers[ti];
        if (existingTierIds.has(tier.uid)) {
          await tx.update(quoteTiers).set({ sortOrder: ti }).where(eq(quoteTiers.id, tier.uid));
          tierIdByUid.set(tier.uid, tier.uid);
        } else {
          const [row] = await tx
            .insert(quoteTiers)
            .values({ quoteId, sortOrder: ti })
            .returning({ id: quoteTiers.id });
          tierIdByUid.set(tier.uid, row.id);
        }
      }
    }

    const sortByTier = new Map<string, number>();
    for (const { tierUid, it } of desired) {
      const key = tierUid ?? "";
      const idx = sortByTier.get(key) ?? 0;
      sortByTier.set(key, idx + 1);

      const values = {
        tierId: tierUid ? (tierIdByUid.get(tierUid) ?? null) : null,
        lineType: it.lineType,
        code: it.code || null,
        altCode: it.altCode?.trim() || null,
        name: it.name.trim(),
        spec: it.spec || null,
        unit: it.unit || "개",
        qty: it.qty || null,
        price: it.price || null,
        supplyOverride: it.supplyOverride || null,
        sortOrder: idx,
        imageDataUrl: it.imageDataUrl || null,
      };
      if (existingItemIds.has(it.uid)) {
        await tx.update(quoteItems).set(values).where(eq(quoteItems.id, it.uid));
      } else {
        await tx.insert(quoteItems).values({ quoteId, ...values });
      }
    }

    // 더 이상 안 쓰는 구간 정리(품목은 위에서 이미 옮기거나 지웠다).
    const unusedTierIds = existingTiers.map((t) => t.id).filter((id) => !tierIdByUid.has(id));
    if (unusedTierIds.length > 0) {
      await tx.delete(quoteTiers).where(inArray(quoteTiers.id, unusedTierIds));
    }
  });

  // 수정으로 새로 생긴 품목명이 자동완성에 보이도록 마스터에만 추가한다(사용횟수는 올리지 않음).
  const names = new Set(desired.map((d) => d.it.name.trim()));
  for (const { it } of desired) {
    const name = it.name.trim();
    if (!names.has(name)) continue;
    names.delete(name);
    if (it.lineType === "product") {
      await db.insert(productSuggestions).values({ name, usageCount: 0 }).onConflictDoNothing();
    } else {
      await db.insert(optionMaster).values({ name, usageCount: 0 }).onConflictDoNothing();
    }
  }

  await syncProjectCustomerWithQuote(projectId, quote.quoteNumber, draft.customerName);

  return { id: quote.id, revision: quote.revision };
}

// 고객사명/담당자/담당자 전화만 수정 저장 — 새 리비전을 만들지 않고 해당 리비전 행을
// 그대로 UPDATE한다(발송요청일 수정과 같은 패턴, po-editor.tsx 참고). 견적 품목/금액이
// 바뀐 게 아니라 담당자가 바뀌었거나 오탈자를 고치는 등 문서 내용 자체는 그대로인 채
// 연락처 정보만 정정되는 경우가 실제로 있어(2026-09-22 피드백) — 이런 정정마다 매번
// 리비전이 올라가면 리비전 이력이 실제 변경 이력과 안 맞아 보인다는 문제 때문에 추가.
export async function updateQuoteCustomerInfo(
  projectId: string,
  quoteId: string,
  fields: { customerName: string; contactName: string; contactPhone: string }
): Promise<void> {
  await requireSession();

  const [quote] = await db
    .select({ id: quotes.id, quoteNumber: quotes.quoteNumber })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.projectId, projectId)))
    .limit(1);
  if (!quote) throw new Error("견적서를 찾을 수 없습니다.");

  const customerName = fields.customerName.trim();
  if (!customerName) throw new Error("고객사명을 입력해주세요.");

  await db
    .update(quotes)
    .set({
      customerName,
      contactName: fields.contactName.trim() || null,
      contactPhone: fields.contactPhone.trim() || null,
    })
    .where(eq(quotes.id, quoteId));

  await syncProjectCustomerWithQuote(projectId, quote.quoteNumber, customerName);
}

async function buildQuoteReference(quoteRow: typeof quotes.$inferSelect): Promise<QuoteReferenceSummary> {
  const itemRows = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteRow.id))
    .orderBy(quoteItems.sortOrder);

  let supply = 0;
  const items = itemRows.map((r) => {
    // 단가로 나누어떨어지지 않는 공급가는 수기 입력된 값(supplyOverride)을 그대로 쓴다.
    const lineAmt = r.supplyOverride != null ? Number(r.supplyOverride) : Number(r.qty ?? 0) * Number(r.price ?? 0);
    supply += lineAmt;
    return {
      id: r.id,
      lineType: r.lineType,
      name: r.name,
      spec: r.spec ?? "",
      unit: r.unit ?? "개",
      qty: r.qty ?? "",
      price: r.price ?? "",
      imageDataUrl: r.imageDataUrl,
      supplyOverride: r.supplyOverride ?? undefined,
    };
  });
  const vat = Math.round(supply * 0.1);
  // 견적 총액을 맞추기 위한 절삭/조정 — 최종 합계에만 반영한다.
  const adjustment = quoteRow.adjustmentAmount != null ? Number(quoteRow.adjustmentAmount) : 0;

  return {
    id: quoteRow.id,
    quoteNumber: quoteRow.quoteNumber,
    revision: quoteRow.revision,
    customerName: quoteRow.customerName,
    contactName: quoteRow.contactName ?? "",
    contactPhone: quoteRow.contactPhone ?? "",
    quoteDate: quoteRow.quoteDate ?? "",
    mode: quoteRow.mode,
    compareProductName: quoteRow.compareProductName ?? "",
    mainImageDataUrl: quoteRow.mainImageDataUrl,
    items,
    supply,
    vat,
    total: supply + vat + adjustment,
  };
}

// 시안/발주서는 "불러오기"로 명시적으로 선택한 견적서에만 연결한다 — 어느 견적이
// 근거인지 자동으로 추측하지 않는다(프로젝트에 견적이 여러 건일 수 있어서, 최근 저장
// 순서가 곧 "이 작업의 근거 견적"이라는 보장이 없다).
export async function getQuoteReferenceById(quoteId: string): Promise<QuoteReferenceSummary | null> {
  await requireSession();
  const [quoteRow] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quoteRow) return null;
  return buildQuoteReference(quoteRow);
}

// "저장된 견적 찾기"에서 견적번호를 골랐을 때 — 그 번호의 최신 리비전을 불러온다
// (검색 목록엔 quoteId가 없이 quoteNumber만 있어서 번호 기준으로 다시 조회).
// revision을 주면 그 리비전을, 안 주면 최신 리비전을 불러온다(거래명세서에서 이전 리비전을 고를 때).
export async function getQuoteReferenceByNumber(
  projectId: string,
  quoteNumber: string,
  revision?: number
): Promise<QuoteReferenceSummary | null> {
  await requireSession();
  const [quoteRow] = await db
    .select()
    .from(quotes)
    .where(
      and(
        eq(quotes.projectId, projectId),
        eq(quotes.quoteNumber, quoteNumber),
        revision != null ? eq(quotes.revision, revision) : undefined
      )
    )
    .orderBy(desc(quotes.revision))
    .limit(1);
  if (!quoteRow) return null;
  return buildQuoteReference(quoteRow);
}

// 견적(리비전) 삭제 전에 시안/발주서/거래명세서가 연결돼 있으면 막는다. 통과하면 이 견적들의 품목
// id 목록을 돌려준다(summary_overrides 정리용).
async function assertQuotesNotLinked(quoteIds: string[]): Promise<string[]> {
  const itemRows = await db
    .select({ id: quoteItems.id })
    .from(quoteItems)
    .where(inArray(quoteItems.quoteId, quoteIds));
  const quoteItemIds = itemRows.map((i) => i.id);

  const [draftHits, poByQuoteHits, poByItemHits, poItemHits, stmtHits, stmtItemHits] = await Promise.all([
    db.select({ id: drafts.id }).from(drafts).where(inArray(drafts.quoteId, quoteIds)).limit(1),
    db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(inArray(purchaseOrders.quoteId, quoteIds)).limit(1),
    quoteItemIds.length
      ? db
          .select({ id: purchaseOrders.id })
          .from(purchaseOrders)
          .where(inArray(purchaseOrders.quoteItemId, quoteItemIds))
          .limit(1)
      : Promise.resolve([]),
    quoteItemIds.length
      ? db.select({ id: poItems.id }).from(poItems).where(inArray(poItems.quoteItemId, quoteItemIds)).limit(1)
      : Promise.resolve([]),
    db
      .select({ id: transactionStatements.id })
      .from(transactionStatements)
      .where(inArray(transactionStatements.quoteId, quoteIds))
      .limit(1),
    quoteItemIds.length
      ? db
          .select({ id: statementItems.id })
          .from(statementItems)
          .where(inArray(statementItems.quoteItemId, quoteItemIds))
          .limit(1)
      : Promise.resolve([]),
  ]);

  if (
    draftHits.length ||
    poByQuoteHits.length ||
    poByItemHits.length ||
    poItemHits.length ||
    stmtHits.length ||
    stmtItemHits.length
  ) {
    throw new Error("이미 시안·발주서·거래명세서가 연결된 견적서는 삭제할 수 없습니다.");
  }

  return quoteItemIds;
}

// 견적서 삭제(모든 리비전) — 잘못 등록했거나 더는 필요 없는 견적을 정리할 때 쓴다
// (2026-09-15). 시안/발주서/거래명세서 등 이미 실제로 만들어진 후속 문서가 하나라도
// 연결되어 있으면 막는다 — 그런 문서가 참조하는 견적을 지우면 그 문서들의 근거가
// 사라지기 때문. quote_tiers/quote_items는 스키마의 onDelete:cascade로 함께 지워지고,
// 이 견적에만 걸려있던 Summary 정정값(summary_overrides)/요청사항(project_requests)은
// 더 이상 의미가 없어 같이 지운다. 관리자만 가능하고 삭제 이력을 남긴다(2026-09-29).
export async function deleteQuote(projectId: string, quoteNumber: string): Promise<void> {
  const session = await requireAdmin();

  const quoteRows = await db
    .select({ id: quotes.id, customerName: quotes.customerName })
    .from(quotes)
    .where(and(eq(quotes.projectId, projectId), eq(quotes.quoteNumber, quoteNumber)));
  if (quoteRows.length === 0) throw new Error("견적서를 찾을 수 없습니다.");
  const quoteIds = quoteRows.map((q) => q.id);

  const quoteItemIds = await assertQuotesNotLinked(quoteIds);

  if (quoteItemIds.length) {
    await db.delete(summaryOverrides).where(inArray(summaryOverrides.rowKey, quoteItemIds));
  }
  await db.delete(projectRequests).where(inArray(projectRequests.quoteId, quoteIds));
  await db.delete(quotes).where(inArray(quotes.id, quoteIds));

  await recordDeletion(session, "quote", `${quoteNumber} (${quoteRows[0].customerName})`, {
    projectId,
    revisionCount: quoteIds.length,
    itemCount: quoteItemIds.length,
  });
}

// 리비전 하나만 삭제(2026-10-22) — "견적서를 두 번 저장했는데 하나만 지우려다 전체가 지워졌다"는 사고 때문에
// 추가. 같은 견적번호의 마지막 하나 남은 리비전은 지울 수 없다(견적 전체 삭제를 쓴다). 삭제 대상 리비전에
// 시안/발주서/거래명세서가 연결돼 있으면 막는다. 관리자만 가능하고 삭제 이력을 남긴다.
export async function deleteQuoteRevision(
  projectId: string,
  quoteNumber: string,
  revision: number
): Promise<void> {
  const session = await requireAdmin();

  const all = await db
    .select({ id: quotes.id, revision: quotes.revision, customerName: quotes.customerName })
    .from(quotes)
    .where(and(eq(quotes.projectId, projectId), eq(quotes.quoteNumber, quoteNumber)));
  const target = all.find((q) => q.revision === revision);
  if (!target) throw new Error("해당 리비전을 찾을 수 없습니다.");
  if (all.length <= 1) {
    throw new Error("마지막 하나 남은 리비전은 지울 수 없습니다. 견적서를 통째로 지우려면 목록의 '전체 삭제'를 쓰세요.");
  }

  const quoteItemIds = await assertQuotesNotLinked([target.id]);

  if (quoteItemIds.length) {
    await db.delete(summaryOverrides).where(inArray(summaryOverrides.rowKey, quoteItemIds));
  }
  await db.delete(projectRequests).where(eq(projectRequests.quoteId, target.id));
  await db.delete(quotes).where(eq(quotes.id, target.id));

  await recordDeletion(
    session,
    "quote",
    `${quoteNumber} Rev.${String(revision).padStart(2, "0")} (${target.customerName})`,
    { projectId, revision, itemCount: quoteItemIds.length, remainingRevisions: all.length - 1 }
  );
}
