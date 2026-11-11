"use server";

import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  taxInvoices,
  taxInvoiceItems,
  transactionStatements,
  statementItems,
  companyProfile,
  taxInvoicePartners,
  projects,
  projectStages,
} from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { generateInvoiceNumber } from "@/lib/tax-invoices/invoice-number";
import {
  advanceLinkedProjects,
  advanceProjectStage,
  assertProjectReachedStage,
} from "@/lib/projects/stage-transition";
import { issueTaxInvoiceViaPopbill, sendTaxInvoiceEmailViaPopbill } from "@/lib/popbill/tax-invoice";
import { isPopbillConfigured } from "@/lib/popbill/client";
import { applyStatementAdjustment, mergeToSingleItem } from "@/lib/tax-invoices/merge-items";
import type {
  BundleStatementCandidate,
  ImportableStatement,
  LinkedStatementInfo,
  TaxInvoiceDraft,
  TaxInvoiceItemDraft,
  TaxPartner,
  TaxInvoiceSummary,
  TaxInvoiceStatus,
} from "@/lib/tax-invoices/types";

async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  return session;
}

// 세금계산서는 대표 거래명세서가 속한 프로젝트(tax_invoices.project_id)에 속하지만, 같은 고객의 다른 프로젝트
// 거래명세서를 함께 묶은 경우(2026-11-11) 그 프로젝트들에서도 같은 세금계산서가 보이고 처리돼야 한다.
function invoiceInProject(projectId: string) {
  return or(
    eq(taxInvoices.projectId, projectId),
    sql`exists (select 1 from ${transactionStatements} where ${transactionStatements.taxInvoiceId} = ${taxInvoices.id} and ${transactionStatements.projectId} = ${projectId})`
  );
}

function normalizeName(name: string | null | undefined): string {
  return (name ?? "").replace(/\s+/g, "").toLowerCase();
}

export async function generateNewInvoiceNumber(): Promise<string> {
  await requireSession();
  return generateInvoiceNumber();
}

// 아직 세금계산서가 안 붙은(tax_invoice_id가 비어있는) 거래명세서만 가져오기 대상으로 보여준다.
export async function listImportableStatements(projectId: string): Promise<ImportableStatement[]> {
  await requireSession();

  const rows = await db
    .select({ id: transactionStatements.id })
    .from(transactionStatements)
    .where(and(eq(transactionStatements.projectId, projectId), isNull(transactionStatements.taxInvoiceId)))
    .orderBy(desc(transactionStatements.createdAt));

  if (rows.length === 0) return [];

  const statements = await db
    .select()
    .from(transactionStatements)
    .where(
      inArray(
        transactionStatements.id,
        rows.map((r) => r.id)
      )
    );

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

  return statements
    .sort((a, b) => b.statementNumber.localeCompare(a.statementNumber))
    .map((s) => ({
      id: s.id,
      statementNumber: s.statementNumber,
      customerName: s.customerName,
      statementDate: s.statementDate,
      itemCount: countMap.get(s.id) ?? 0,
      cashReceiptIssuedAt: s.cashReceiptIssuedAt ?? null,
    }));
}

export type ImportedStatementData = {
  customerName: string;
  customerBusinessNumber: string;
  customerAddress: string;
  items: TaxInvoiceItemDraft[];
  statements: LinkedStatementInfo[];
};

// 거래명세서 하나 또는 여러 개(같은 고객의 다른 프로젝트 것을 함께 묶을 때)의 품목을 세금계산서 한 줄로
// 합쳐 가져온다. 첫 번째 id가 대표(고객 정보를 이어받는다). 명세서마다 절삭/조정을 반영한 공급가액·세액을
// 구해 더하고, 품명은 모든 품목 줄을 합쳐 "첫 품명 외 N건"으로 만든다.
export async function importFromStatements(statementIds: string[]): Promise<ImportedStatementData | null> {
  await requireSession();

  const ids = [...new Set(statementIds)];
  if (ids.length === 0) return null;

  const stmtRows = await db
    .select({ statement: transactionStatements, projectNumber: projects.projectNumber })
    .from(transactionStatements)
    .innerJoin(projects, eq(transactionStatements.projectId, projects.id))
    .where(inArray(transactionStatements.id, ids));
  const byId = new Map(stmtRows.map((r) => [r.statement.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  if (ordered.length === 0) return null;
  const primary = ordered[0].statement;

  const itemRows = await db
    .select()
    .from(statementItems)
    .where(inArray(statementItems.statementId, ids))
    .orderBy(statementItems.sortOrder);

  let supply = 0;
  let tax = 0;
  const allRows: typeof itemRows = [];
  for (const { statement } of ordered) {
    const rows = itemRows.filter((r) => r.statementId === statement.id);
    const merged = mergeToSingleItem(rows);
    // 거래명세서에 절삭/조정이 있으면 세금계산서 합계도 명세서 합계와 같아지도록 공급가액/세액에 반영한다.
    const adj = applyStatementAdjustment(rows, Number(statement.adjustmentAmount ?? 0) || 0, merged);
    supply += adj.supply;
    tax += adj.tax;
    allRows.push(...rows);
  }
  // 거래명세서 품목이 몇 줄이든 세금계산서엔 품명 하나로 합쳐서 가져온다(2026-09-22).
  const mergedAll = mergeToSingleItem(allRows);

  return {
    customerName: primary.customerName,
    // 거래명세서에 이미 입력된 값이 있으면(사업자등록증을 그때 이미 받은 경우) 그대로 이어받는다.
    customerBusinessNumber: primary.customerBusinessNumber ?? "",
    customerAddress: primary.customerAddress ?? "",
    items:
      mergedAll.name === ""
        ? []
        : [
            {
              uid: "item-1",
              name: mergedAll.name,
              qty: mergedAll.qty,
              supplyOverride: supply ? String(Math.round(supply)) : "",
              taxOverride: tax ? String(Math.round(tax)) : "",
            },
          ],
    statements: ordered.map((r) => ({
      id: r.statement.id,
      statementNumber: r.statement.statementNumber,
      projectNumber: r.projectNumber,
    })),
  };
}

export async function importFromStatement(statementId: string): Promise<ImportedStatementData | null> {
  return importFromStatements([statementId]);
}

// 같은 고객의 "다른" 거래명세서 중 이 세금계산서에 함께 묶을 수 있는 것(2026-11-11) — 아직 세금계산서가
// 안 붙었고, 현금영수증이 발행되지 않았고, 소속 프로젝트가 거래명세서 발송 단계 이상인 것만. 같은 고객은
// 프로젝트의 고객(customers) 일치 또는 거래명세서 수신 고객사명 일치(공백 무시)로 본다.
export async function listBundleCandidateStatements(primaryStatementId: string): Promise<BundleStatementCandidate[]> {
  await requireSession();

  const [primary] = await db
    .select({
      customerName: transactionStatements.customerName,
      customerId: projects.customerId,
    })
    .from(transactionStatements)
    .innerJoin(projects, eq(transactionStatements.projectId, projects.id))
    .where(eq(transactionStatements.id, primaryStatementId))
    .limit(1);
  if (!primary) return [];

  const [requiredStage] = await db
    .select()
    .from(projectStages)
    .where(eq(projectStages.stageCode, "statement_sent"))
    .limit(1);

  const rows = await db
    .select({
      id: transactionStatements.id,
      statementNumber: transactionStatements.statementNumber,
      customerName: transactionStatements.customerName,
      statementDate: transactionStatements.statementDate,
      cashReceiptIssuedAt: transactionStatements.cashReceiptIssuedAt,
      projectNumber: projects.projectNumber,
      projectCustomerId: projects.customerId,
      stageSortOrder: projectStages.sortOrder,
    })
    .from(transactionStatements)
    .innerJoin(projects, eq(transactionStatements.projectId, projects.id))
    .leftJoin(projectStages, eq(projects.currentStageId, projectStages.id))
    .where(and(isNull(transactionStatements.taxInvoiceId), ne(transactionStatements.id, primaryStatementId)))
    .orderBy(desc(transactionStatements.createdAt));

  const targetKey = normalizeName(primary.customerName);
  const candidates = rows.filter(
    (r) =>
      !r.cashReceiptIssuedAt &&
      (r.projectCustomerId === primary.customerId || normalizeName(r.customerName) === targetKey) &&
      (requiredStage ? (r.stageSortOrder ?? 0) >= requiredStage.sortOrder : true)
  );
  if (candidates.length === 0) return [];

  const items = await db
    .select({
      statementId: statementItems.statementId,
      name: statementItems.name,
      lineType: statementItems.lineType,
    })
    .from(statementItems)
    .where(
      inArray(
        statementItems.statementId,
        candidates.map((c) => c.id)
      )
    )
    .orderBy(statementItems.sortOrder);
  const countMap = new Map<string, number>();
  const firstProduct = new Map<string, string>();
  const firstAny = new Map<string, string>();
  for (const it of items) {
    countMap.set(it.statementId, (countMap.get(it.statementId) ?? 0) + 1);
    if (it.lineType === "product" && !firstProduct.has(it.statementId)) firstProduct.set(it.statementId, it.name);
    if (!firstAny.has(it.statementId)) firstAny.set(it.statementId, it.name);
  }

  return candidates.map((c) => ({
    id: c.id,
    statementNumber: c.statementNumber,
    projectNumber: c.projectNumber,
    customerName: c.customerName,
    statementDate: c.statementDate,
    itemCount: countMap.get(c.id) ?? 0,
    firstItemName: firstProduct.get(c.id) ?? firstAny.get(c.id) ?? "",
  }));
}

function toStatus(value: string): TaxInvoiceStatus {
  return value === "confirmed" || value === "issued" ? value : "requested";
}

export async function listTaxInvoices(projectId: string): Promise<TaxInvoiceSummary[]> {
  await requireSession();

  const rows = await db
    .select()
    .from(taxInvoices)
    .where(invoiceInProject(projectId))
    .orderBy(desc(taxInvoices.createdAt));

  if (rows.length === 0) return [];

  const itemCounts = await db
    .select({ taxInvoiceId: taxInvoiceItems.taxInvoiceId, count: sql<number>`count(*)::int` })
    .from(taxInvoiceItems)
    .where(
      inArray(
        taxInvoiceItems.taxInvoiceId,
        rows.map((r) => r.id)
      )
    )
    .groupBy(taxInvoiceItems.taxInvoiceId);
  const countMap = new Map(itemCounts.map((c) => [c.taxInvoiceId, c.count]));

  return rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    customerName: r.customerName,
    status: toStatus(r.status),
    scheduledDate: r.scheduledDate,
    requestedAt: r.requestedAt.toISOString(),
    confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
    issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
    itemCount: countMap.get(r.id) ?? 0,
  }));
}

export async function loadTaxInvoice(projectId: string, invoiceId: string): Promise<TaxInvoiceDraft | null> {
  await requireSession();

  const [row] = await db
    .select()
    .from(taxInvoices)
    .where(and(eq(taxInvoices.id, invoiceId), invoiceInProject(projectId)))
    .limit(1);
  if (!row) return null;

  const itemRows = await db
    .select()
    .from(taxInvoiceItems)
    .where(eq(taxInvoiceItems.taxInvoiceId, row.id))
    .orderBy(taxInvoiceItems.sortOrder);

  // 품목을 한 줄로 합치기로 바꾸기(2026-09-22) 전에 저장된 세금계산서는 여러 줄로 저장돼
  // 있을 수 있다 — 불러올 때 항상 한 줄로 합쳐서 보여준다(다시 저장하면 실제로 한 줄이 된다).
  const merged = mergeToSingleItem(itemRows);

  const linkedStatements = await db
    .select({
      id: transactionStatements.id,
      statementNumber: transactionStatements.statementNumber,
      projectNumber: projects.projectNumber,
    })
    .from(transactionStatements)
    .innerJoin(projects, eq(transactionStatements.projectId, projects.id))
    .where(eq(transactionStatements.taxInvoiceId, row.id))
    .orderBy(transactionStatements.statementNumber);

  return {
    invoiceNumber: row.invoiceNumber,
    statementId: row.statementId,
    bundledStatementIds: [],
    linkedStatements,
    customerName: row.customerName,
    purposeType: row.purposeType === "영수" ? "영수" : "청구",
    customerBusinessNumber: row.customerBusinessNumber ?? "",
    customerSubNum: row.customerSubNum ?? "",
    customerCeoName: row.customerCeoName ?? "",
    customerAddress: row.customerAddress ?? "",
    customerBusinessType: row.customerBusinessType ?? "",
    customerBusinessItem: row.customerBusinessItem ?? "",
    customerEmail: row.customerEmail ?? "",
    scheduledDate: row.scheduledDate ?? "",
    note: row.note ?? "",
    hometaxSent: row.hometaxSent,
    lastEmailSentTo: row.lastEmailSentTo ?? undefined,
    lastEmailSentAt: row.lastEmailSentAt ? row.lastEmailSentAt.toISOString() : undefined,
    items:
      merged.name === ""
        ? []
        : [
            {
              uid: itemRows[0]?.id ?? "item-1",
              name: merged.name,
              qty: merged.qty,
              supplyOverride: merged.supply ? String(Math.round(merged.supply)) : "",
              taxOverride: merged.tax ? String(Math.round(merged.tax)) : "",
            },
          ],
  };
}

// 세금계산서 거래처 기준정보 검색(2026-10-12) — 상호 일부 또는 사업자등록번호(숫자만 입력해도 됨)로
// 찾는다. 폐업 거래처는 뒤로 보내고, 상호가 검색어로 시작하는 것을 먼저 보여준다.
function toTaxPartner(r: typeof taxInvoicePartners.$inferSelect): TaxPartner {
  return {
    id: r.id,
    companyName: r.companyName,
    businessNumber: r.businessNumber,
    subNum: r.subNum,
    ceoName: r.ceoName ?? "",
    address: r.address ?? "",
    businessType: r.businessType ?? "",
    businessItem: r.businessItem ?? "",
    email: r.email ?? "",
    isClosed: r.isClosed,
  };
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function searchTaxPartners(query: string): Promise<TaxPartner[]> {
  await requireSession();
  const q = query.trim();
  if (!q) return [];

  const digits = q.replace(/\D/g, "");
  const conditions = [ilike(taxInvoicePartners.companyName, `%${escapeLike(q)}%`)];
  if (digits.length >= 3) {
    conditions.push(sql`replace(${taxInvoicePartners.businessNumber}, '-', '') like ${`%${digits}%`}`);
  }

  const rows = await db
    .select()
    .from(taxInvoicePartners)
    .where(or(...conditions))
    .orderBy(
      asc(taxInvoicePartners.isClosed),
      sql`case when ${taxInvoicePartners.companyName} ilike ${`${escapeLike(q)}%`} then 0 else 1 end`,
      asc(taxInvoicePartners.companyName)
    )
    .limit(20);
  return rows.map(toTaxPartner);
}

// 거래명세서를 불러올 때 상호가 기준정보와 정확히 일치하면(공백 무시) 사업자 정보를 자동으로
// 채워주기 위한 조회 — 일치하는 (폐업 아닌) 거래처가 정확히 한 곳일 때만 돌려준다(동명이 여럿이면
// 사람이 고르게 한다).
export async function findTaxPartnerByExactName(name: string): Promise<TaxPartner | null> {
  await requireSession();
  const key = name.replace(/\s+/g, "");
  if (!key) return null;
  const rows = await db
    .select()
    .from(taxInvoicePartners)
    .where(
      and(sql`replace(${taxInvoicePartners.companyName}, ' ', '') = ${key}`, eq(taxInvoicePartners.isClosed, false))
    )
    .limit(2);
  return rows.length === 1 ? toTaxPartner(rows[0]) : null;
}

// 발행 요청 때 화면에 입력/수정한 공급받는자 정보를 거래처 기준정보에 저장한다(2026-10-22) —
// 기준정보에 없던 (사업자번호, 종사업장번호)는 새로 등록하고, 이미 있는데 상호/대표/주소/업태/종목/
// 이메일을 고쳤다면 기준정보도 같이 고친다(비워서 낸 칸은 기존 값을 지우지 않는다). 고친 행은
// source='manual'로 바꿔 팝빌 거래처목록을 다시 가져와도 덮어쓰지 않게 한다.
// 팝빌 쪽 "거래처 관리" 목록은 API가 없어 자동으로 바꿀 수 없다 — 팝빌에는 발행 문서에 실린 값이
// 그대로 전달된다(lib/popbill/tax-invoice.ts). 저장 실패가 발행 요청 자체를 막으면 안 되므로
// 호출부에서 격리한다.
export type PartnerSaveResult = "created" | "updated" | "unchanged" | "skipped";

async function savePartnerFromInvoice(draft: TaxInvoiceDraft): Promise<PartnerSaveResult> {
  const businessNumber = draft.customerBusinessNumber.trim();
  const companyName = draft.customerName.trim();
  if (!businessNumber || !companyName) return "skipped";
  const subNum = draft.customerSubNum.trim();

  const next = {
    companyName,
    ceoName: draft.customerCeoName.trim() || null,
    address: draft.customerAddress.trim() || null,
    businessType: draft.customerBusinessType.trim() || null,
    businessItem: draft.customerBusinessItem.trim() || null,
    email: draft.customerEmail.trim() || null,
  };

  const [existing] = await db
    .select()
    .from(taxInvoicePartners)
    .where(and(eq(taxInvoicePartners.businessNumber, businessNumber), eq(taxInvoicePartners.subNum, subNum)))
    .limit(1);

  if (!existing) {
    await db
      .insert(taxInvoicePartners)
      .values({ businessNumber, subNum, ...next, source: "manual" })
      .onConflictDoNothing();
    return "created";
  }

  const merged = {
    companyName: next.companyName,
    ceoName: next.ceoName ?? existing.ceoName,
    address: next.address ?? existing.address,
    businessType: next.businessType ?? existing.businessType,
    businessItem: next.businessItem ?? existing.businessItem,
    email: next.email ?? existing.email,
  };
  const changed =
    merged.companyName !== existing.companyName ||
    merged.ceoName !== existing.ceoName ||
    merged.address !== existing.address ||
    merged.businessType !== existing.businessType ||
    merged.businessItem !== existing.businessItem ||
    merged.email !== existing.email;
  if (!changed) return "unchanged";

  await db
    .update(taxInvoicePartners)
    .set({ ...merged, source: "manual", updatedAt: new Date() })
    .where(eq(taxInvoicePartners.id, existing.id));
  return "updated";
}

async function requestTaxInvoiceImpl(
  projectId: string,
  draft: TaxInvoiceDraft
): Promise<{ id: string; partner: PartnerSaveResult }> {
  const session = await requireSession();

  const invoiceNumber = draft.invoiceNumber.trim();
  if (!invoiceNumber) throw new Error("세금계산서 번호를 입력해주세요.");
  if (!draft.customerName.trim()) throw new Error("공급받는자(고객사)를 입력해주세요.");
  if (!draft.statementId) throw new Error("연결할 거래명세서를 먼저 선택해주세요.");
  if (draft.items.filter((it) => it.name.trim() !== "").length === 0) {
    throw new Error("품목을 1개 이상 입력해주세요.");
  }

  // invoice_number는 유니크 제약이라, 저장된 세금계산서를 "보기"로 불러온 뒤 그대로 다시
  // 요청하면 DB 에러가 난다 — 리비전 없는 문서라 새 번호가 필요하다는 걸 먼저 알려준다.
  const [existing] = await db
    .select({ id: taxInvoices.id })
    .from(taxInvoices)
    .where(eq(taxInvoices.invoiceNumber, invoiceNumber))
    .limit(1);
  if (existing) {
    throw new Error(
      `이미 저장된 세금계산서 번호입니다 (${invoiceNumber}). 리비전 없이 저장 즉시 확정되는 문서라, 같은 번호로 다시 요청할 수 없습니다 — "세금계산서 번호"를 새 번호로 바꾼 뒤 다시 요청해주세요.`
    );
  }

  // 현금영수증(소득공제/지출증빙)을 이미 발행한 거래는 같은 거래에 세금계산서를 또 발행하면 이중
  // 증빙이 되므로 막는다(2026-10-19). 세금계산서가 정말 필요하면 거래명세서 화면에서 현금영수증
  // 발행일을 먼저 지운다.
  const [linkedStatement] = await db
    .select({
      cashReceiptIssuedAt: transactionStatements.cashReceiptIssuedAt,
      statementNumber: transactionStatements.statementNumber,
      taxInvoiceId: transactionStatements.taxInvoiceId,
      customerName: transactionStatements.customerName,
      customerId: projects.customerId,
    })
    .from(transactionStatements)
    .innerJoin(projects, eq(transactionStatements.projectId, projects.id))
    .where(eq(transactionStatements.id, draft.statementId))
    .limit(1);
  if (linkedStatement?.cashReceiptIssuedAt) {
    throw new Error(
      `${linkedStatement.statementNumber}은 현금영수증이 이미 발행된 거래(${linkedStatement.cashReceiptIssuedAt})라 세금계산서를 발행할 수 없습니다. 세금계산서로 바꿔야 한다면 거래명세서 화면에서 현금영수증 발행일을 먼저 지워주세요.`
    );
  }
  if (linkedStatement?.taxInvoiceId) {
    throw new Error(`${linkedStatement.statementNumber}은 이미 다른 세금계산서에 연결돼 있습니다.`);
  }

  // 세금계산서는 거래명세서가 발송된 뒤에만 요청할 수 있다 (6. 거래명세서 발송 완료 이후).
  await assertProjectReachedStage(projectId, "statement_sent");

  // 같은 고객의 다른 프로젝트 거래명세서를 함께 묶는 경우(2026-11-11) — 화면 값을 믿지 않고 서버에서 다시 검사한다:
  // 존재, 아직 다른 세금계산서에 안 묶임, 현금영수증 미발행, 같은 고객, 소속 프로젝트가 거래명세서 발송 단계 이상.
  const bundledIds = [...new Set(draft.bundledStatementIds ?? [])].filter((id) => id !== draft.statementId);
  if (bundledIds.length > 0) {
    const bundledRows = await db
      .select({
        id: transactionStatements.id,
        statementNumber: transactionStatements.statementNumber,
        taxInvoiceId: transactionStatements.taxInvoiceId,
        cashReceiptIssuedAt: transactionStatements.cashReceiptIssuedAt,
        customerName: transactionStatements.customerName,
        projectId: transactionStatements.projectId,
        customerId: projects.customerId,
      })
      .from(transactionStatements)
      .innerJoin(projects, eq(transactionStatements.projectId, projects.id))
      .where(inArray(transactionStatements.id, bundledIds));
    if (bundledRows.length !== bundledIds.length) {
      throw new Error("함께 묶으려는 거래명세서를 찾을 수 없습니다. 화면을 새로고침한 뒤 다시 시도해주세요.");
    }
    for (const b of bundledRows) {
      if (b.taxInvoiceId) throw new Error(`${b.statementNumber}은 이미 다른 세금계산서에 연결돼 있습니다.`);
      if (b.cashReceiptIssuedAt) {
        throw new Error(`${b.statementNumber}은 현금영수증이 이미 발행된 거래라 세금계산서에 묶을 수 없습니다.`);
      }
      const sameCustomer =
        b.customerId === linkedStatement?.customerId ||
        normalizeName(b.customerName) === normalizeName(linkedStatement?.customerName);
      if (!sameCustomer) {
        throw new Error(`${b.statementNumber}은 다른 고객(${b.customerName})의 거래명세서라 함께 묶을 수 없습니다.`);
      }
      await assertProjectReachedStage(b.projectId, "statement_sent");
    }
  }

  const [created] = await db
    .insert(taxInvoices)
    .values({
      projectId,
      statementId: draft.statementId,
      invoiceNumber,
      customerName: draft.customerName.trim(),
      purposeType: draft.purposeType === "영수" ? "영수" : "청구",
      customerBusinessNumber: draft.customerBusinessNumber.trim() || null,
      customerSubNum: draft.customerSubNum.trim() || null,
      customerCeoName: draft.customerCeoName.trim() || null,
      customerAddress: draft.customerAddress.trim() || null,
      customerBusinessType: draft.customerBusinessType.trim() || null,
      customerBusinessItem: draft.customerBusinessItem.trim() || null,
      customerEmail: draft.customerEmail.trim() || null,
      status: "requested",
      scheduledDate: draft.scheduledDate || null,
      hometaxSent: draft.hometaxSent,
      note: draft.note || null,
      requestedBy: session.userId,
    })
    .returning({ id: taxInvoices.id });

  // 세금계산서 품목은 한 줄로만 저장한다(2026-09-22) — 단가/규격/단위/코드는 더 이상 안 쓴다.
  const itemsToInsert = draft.items
    .filter((it) => it.name.trim() !== "")
    .slice(0, 1)
    .map((it, idx) => ({
      taxInvoiceId: created.id,
      name: it.name.trim(),
      qty: it.qty || null,
      supplyOverride: it.supplyOverride || null,
      taxOverride: it.taxOverride || null,
      sortOrder: idx,
    }));

  await db.insert(taxInvoiceItems).values(itemsToInsert);

  // 원본 거래명세서에 이 세금계산서를 연결 (나중에 붙는 구조).
  // 사업자등록증 정보(등록번호/주소)가 입력됐으면 거래명세서에도 반영한다 — 재발송은 하지
  // 않고 저장된 데이터만 최신화한다. 빈 값으로 기존 값을 덮어쓰지는 않는다.
  const statementUpdate: { taxInvoiceId: string; customerBusinessNumber?: string; customerAddress?: string } = {
    taxInvoiceId: created.id,
  };
  if (draft.customerBusinessNumber.trim()) statementUpdate.customerBusinessNumber = draft.customerBusinessNumber.trim();
  if (draft.customerAddress.trim()) statementUpdate.customerAddress = draft.customerAddress.trim();

  // 대표 거래명세서와 함께 묶은 거래명세서 모두에 이 세금계산서를 연결한다.
  await db
    .update(transactionStatements)
    .set(statementUpdate)
    .where(inArray(transactionStatements.id, [draft.statementId, ...bundledIds]));

  let partner: PartnerSaveResult = "skipped";
  try {
    partner = await savePartnerFromInvoice(draft);
  } catch (err) {
    console.error("세금계산서 거래처 기준정보 저장 실패", err);
  }

  return { id: created.id, partner };
}

// 운영 빌드에서는 서버 액션이 던진 오류 메시지가 가려져 "Minified React error #441"만 보이므로(거래명세서
// 저장과 같은 문제), 발행 요청도 사용자가 고칠 수 있는 오류(현금영수증 발행 건, 번호 중복, 단계 미도달 등)를
// 던지지 않고 결과로 돌려준다.
export type RequestTaxInvoiceResult =
  | { ok: true; id: string; partner: PartnerSaveResult }
  | { ok: false; error: string };

export async function requestTaxInvoice(projectId: string, draft: TaxInvoiceDraft): Promise<RequestTaxInvoiceResult> {
  try {
    const { id, partner } = await requestTaxInvoiceImpl(projectId, draft);
    return { ok: true, id, partner };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
    return { ok: false, error: raw.split(String.fromCharCode(10))[0].slice(0, 300) };
  }
}

export async function confirmTaxInvoice(projectId: string, invoiceId: string): Promise<void> {
  const session = await requireSession();

  const [row] = await db
    .select({ id: taxInvoices.id })
    .from(taxInvoices)
    .where(and(eq(taxInvoices.id, invoiceId), invoiceInProject(projectId)))
    .limit(1);
  if (!row) throw new Error("세금계산서를 찾을 수 없습니다.");

  await db
    .update(taxInvoices)
    .set({ status: "confirmed", confirmedAt: new Date(), confirmedBy: session.userId })
    .where(eq(taxInvoices.id, invoiceId));
}

export type IssueTaxInvoiceResult = {
  // popbill: "sent" = 팝빌로 실제 발행/국세청 접수까지 완료, "skipped" = 팝빌 미설정이라
  // 내부적으로만 "발행 완료" 처리(기존 동작 그대로), "failed" = 팝빌 호출은 했지만 실패.
  popbill: "sent" | "skipped" | "failed";
  popbillMessage?: string;
};

export async function issueTaxInvoice(projectId: string, invoiceId: string): Promise<IssueTaxInvoiceResult> {
  const session = await requireSession();

  const [row] = await db
    .select({ id: taxInvoices.id, customerBusinessNumber: taxInvoices.customerBusinessNumber })
    .from(taxInvoices)
    .where(and(eq(taxInvoices.id, invoiceId), invoiceInProject(projectId)))
    .limit(1);
  if (!row) throw new Error("세금계산서를 찾을 수 없습니다.");
  // 사업자등록번호 없이는 실제로 세금계산서를 발행할 수 없다 — 사업자등록증을 받은 뒤
  // 등록번호를 입력해야 "발행 완료" 처리가 가능하다.
  if (!row.customerBusinessNumber?.trim()) {
    throw new Error("공급받는자 사업자등록번호가 없으면 발행 완료 처리할 수 없습니다. 사업자등록증을 받은 뒤 등록번호를 입력해주세요.");
  }

  // 팝빌 연동(2026-09-03 준비) — 계정이 설정돼 있으면 실제 국세청 접수까지 시도하고,
  // 안 돼 있으면 지금까지 해오던 대로 내부 상태만 "발행 완료"로 기록한다(앱 동작은 그대로).
  // 팝빌 호출이 "시도됐는데 실패"한 경우는 실제로 국세청에 아무것도 접수되지 않은
  // 상태라 내부 상태를 "발행 완료"로 조용히 넘기지 않고 에러로 막는다 — 세금계산서는
  // 실물 문서와 상태가 어긋나면 안 되는 문서라서(회계상 리스크).
  let result: IssueTaxInvoiceResult;
  if (isPopbillConfigured()) {
    const popbillResult = await issueTaxInvoiceViaPopbill(invoiceId);
    if (!popbillResult.ok) {
      throw new Error(`팝빌 발행 실패: ${popbillResult.error}`);
    }
    result = { popbill: "sent", popbillMessage: popbillResult.ntsConfirmNum };
  } else {
    result = { popbill: "skipped" };
  }

  await db
    .update(taxInvoices)
    .set({
      status: "issued",
      issuedAt: new Date(),
      issuedBy: session.userId,
      hometaxSent: result.popbill === "sent",
    })
    .where(eq(taxInvoices.id, invoiceId));

  await advanceProjectStage(projectId, "tax_invoice_issued", session.userId);
  // 거래명세서에 다른 프로젝트의 견적서가 묶여 있으면 그 프로젝트들도 함께 진행시킨다.
  const [invoiceRow] = await db
    .select({ statementId: taxInvoices.statementId, projectId: taxInvoices.projectId })
    .from(taxInvoices)
    .where(eq(taxInvoices.id, invoiceId))
    .limit(1);
  if (invoiceRow?.statementId) {
    await advanceLinkedProjects(invoiceRow.statementId, projectId, "tax_invoice_issued", session.userId);
  }
  // 같은 고객의 다른 프로젝트 거래명세서를 이 세금계산서에 함께 묶은 경우(2026-11-11) 그 프로젝트들(과 그
  // 명세서에 묶인 다른 프로젝트 견적서)도 같은 단계로 진행시킨다.
  const linkedStatements = await db
    .select({ id: transactionStatements.id, projectId: transactionStatements.projectId })
    .from(transactionStatements)
    .where(eq(transactionStatements.taxInvoiceId, invoiceId));
  const handled = new Set([projectId]);
  for (const ls of linkedStatements) {
    if (!handled.has(ls.projectId)) {
      await advanceProjectStage(ls.projectId, "tax_invoice_issued", session.userId);
      handled.add(ls.projectId);
    }
    await advanceLinkedProjects(ls.id, ls.projectId, "tax_invoice_issued", session.userId);
  }
  if (invoiceRow && !handled.has(invoiceRow.projectId)) {
    await advanceProjectStage(invoiceRow.projectId, "tax_invoice_issued", session.userId);
  }

  return result;
}

export type SendTaxInvoiceEmailResult = { ok: true; ccOk?: boolean } | { ok: false; error: string };

// 발행 완료된 세금계산서를 원하는 이메일로 보낸다 — 발행 시점과 무관하게 언제든,
// 여러 번 다시 보낼 수 있다(2026-09-22).
export async function sendTaxInvoiceEmail(
  projectId: string,
  invoiceId: string,
  email: string
): Promise<SendTaxInvoiceEmailResult> {
  await requireSession();
  if (!email.trim()) throw new Error("보낼 이메일 주소를 입력해주세요.");

  const [row] = await db
    .select({ invoiceNumber: taxInvoices.invoiceNumber, status: taxInvoices.status })
    .from(taxInvoices)
    .where(and(eq(taxInvoices.id, invoiceId), invoiceInProject(projectId)))
    .limit(1);
  if (!row) throw new Error("세금계산서를 찾을 수 없습니다.");
  if (row.status !== "issued") {
    throw new Error("발행 완료된 세금계산서만 이메일로 보낼 수 있습니다.");
  }

  // 고객에게 보낼 때 우리 회사 이메일에도 항상 같은 문서를 함께 보낸다(2026-09-29) —
  // company_profile.email이 없으면(설정 전) 하드코딩된 기본 주소로 대신한다.
  const [company] = await db.select({ email: companyProfile.email }).from(companyProfile).limit(1);
  const ccEmail = company?.email || "dsm-tech@naver.com";

  const result = await sendTaxInvoiceEmailViaPopbill(row.invoiceNumber, email.trim(), ccEmail);
  // 성공하면 최근 발송 주소/시각을 남겨둔다 — 이미 발행 완료된 문서는 이메일을
  // 문서 자체에 소급 등록할 수 없어서, 실제로 보냈다는 걸 우리 앱에서라도 확인할 수
  // 있게 한다(2026-09-25, 팝빌 처리 로그에만 남고 우리 쪽엔 기록이 없어 "확인이 안
  // 된다"는 혼란이 있었다).
  if (result.ok) {
    await db
      .update(taxInvoices)
      .set({ lastEmailSentTo: email.trim(), lastEmailSentAt: new Date() })
      .where(eq(taxInvoices.id, invoiceId));
  }
  return result;
}
