"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { quotes, quoteTiers, quoteItems, optionMaster, productSuggestions } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
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
      quoteDate: r.quoteDate,
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
    quoteNumber: quoteRow.quoteNumber,
    mode: quoteRow.mode as QuoteDraft["mode"],
    customerName: quoteRow.customerName,
    contactName: quoteRow.contactName ?? "",
    contactPhone: quoteRow.contactPhone ?? "",
    quoteDate: quoteRow.quoteDate,
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
  revision: number;
  createdAt: string;
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
      quoteDate: draft.quoteDate,
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

  return { revision: nextRevision, createdAt: created.createdAt.toISOString() };
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
    quoteDate: quoteRow.quoteDate,
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
export async function getQuoteReferenceByNumber(
  projectId: string,
  quoteNumber: string
): Promise<QuoteReferenceSummary | null> {
  await requireSession();
  const [quoteRow] = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.projectId, projectId), eq(quotes.quoteNumber, quoteNumber)))
    .orderBy(desc(quotes.revision))
    .limit(1);
  if (!quoteRow) return null;
  return buildQuoteReference(quoteRow);
}
