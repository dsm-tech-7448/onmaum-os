"use server";

import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  taxInvoices,
  taxInvoiceItems,
  transactionStatements,
  statementItems,
  companyProfile,
  taxInvoicePartners,
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
  ImportableStatement,
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

export async function importFromStatement(statementId: string): Promise<{
  customerName: string;
  customerBusinessNumber: string;
  customerAddress: string;
  items: TaxInvoiceItemDraft[];
} | null> {
  await requireSession();

  const [statement] = await db
    .select()
    .from(transactionStatements)
    .where(eq(transactionStatements.id, statementId))
    .limit(1);
  if (!statement) return null;

  const itemRows = await db
    .select()
    .from(statementItems)
    .where(eq(statementItems.statementId, statementId))
    .orderBy(statementItems.sortOrder);

  // 거래명세서 품목이 몇 줄이든 세금계산서엔 품명 하나로 합쳐서 가져온다(2026-09-22).
  const merged = mergeToSingleItem(itemRows);
  // 거래명세서에 절삭/조정이 있으면 세금계산서 합계도 명세서 합계와 같아지도록 공급가액/세액에 반영한다.
  const { supply, tax } = applyStatementAdjustment(itemRows, Number(statement.adjustmentAmount ?? 0) || 0, merged);

  return {
    customerName: statement.customerName,
    // 거래명세서에 이미 입력된 값이 있으면(사업자등록증을 그때 이미 받은 경우) 그대로 이어받는다.
    customerBusinessNumber: statement.customerBusinessNumber ?? "",
    customerAddress: statement.customerAddress ?? "",
    items:
      merged.name === ""
        ? []
        : [
            {
              uid: "item-1",
              name: merged.name,
              qty: merged.qty,
              supplyOverride: supply ? String(Math.round(supply)) : "",
              taxOverride: tax ? String(Math.round(tax)) : "",
            },
          ],
  };
}

function toStatus(value: string): TaxInvoiceStatus {
  return value === "confirmed" || value === "issued" ? value : "requested";
}

export async function listTaxInvoices(projectId: string): Promise<TaxInvoiceSummary[]> {
  await requireSession();

  const rows = await db
    .select()
    .from(taxInvoices)
    .where(eq(taxInvoices.projectId, projectId))
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
    .where(and(eq(taxInvoices.id, invoiceId), eq(taxInvoices.projectId, projectId)))
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

  return {
    invoiceNumber: row.invoiceNumber,
    statementId: row.statementId,
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
    .select({ cashReceiptIssuedAt: transactionStatements.cashReceiptIssuedAt, statementNumber: transactionStatements.statementNumber })
    .from(transactionStatements)
    .where(eq(transactionStatements.id, draft.statementId))
    .limit(1);
  if (linkedStatement?.cashReceiptIssuedAt) {
    throw new Error(
      `${linkedStatement.statementNumber}은 현금영수증이 이미 발행된 거래(${linkedStatement.cashReceiptIssuedAt})라 세금계산서를 발행할 수 없습니다. 세금계산서로 바꿔야 한다면 거래명세서 화면에서 현금영수증 발행일을 먼저 지워주세요.`
    );
  }

  // 세금계산서는 거래명세서가 발송된 뒤에만 요청할 수 있다 (6. 거래명세서 발송 완료 이후).
  await assertProjectReachedStage(projectId, "statement_sent");

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

  await db.update(transactionStatements).set(statementUpdate).where(eq(transactionStatements.id, draft.statementId));

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
    .where(and(eq(taxInvoices.id, invoiceId), eq(taxInvoices.projectId, projectId)))
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
    .where(and(eq(taxInvoices.id, invoiceId), eq(taxInvoices.projectId, projectId)))
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
    .select({ statementId: taxInvoices.statementId })
    .from(taxInvoices)
    .where(eq(taxInvoices.id, invoiceId))
    .limit(1);
  if (invoiceRow?.statementId) {
    await advanceLinkedProjects(invoiceRow.statementId, projectId, "tax_invoice_issued", session.userId);
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
    .where(and(eq(taxInvoices.id, invoiceId), eq(taxInvoices.projectId, projectId)))
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
