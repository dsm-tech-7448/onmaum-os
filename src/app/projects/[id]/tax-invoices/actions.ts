"use server";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  taxInvoices,
  taxInvoiceItems,
  transactionStatements,
  statementItems,
} from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { generateInvoiceNumber } from "@/lib/tax-invoices/invoice-number";
import { advanceProjectStage, assertProjectReachedStage } from "@/lib/projects/stage-transition";
import { issueTaxInvoiceViaPopbill } from "@/lib/popbill/tax-invoice";
import { isPopbillConfigured } from "@/lib/popbill/client";
import type {
  ImportableStatement,
  TaxInvoiceDraft,
  TaxInvoiceItemDraft,
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

  return {
    customerName: statement.customerName,
    // 거래명세서에 이미 입력된 값이 있으면(사업자등록증을 그때 이미 받은 경우) 그대로 이어받는다.
    customerBusinessNumber: statement.customerBusinessNumber ?? "",
    customerAddress: statement.customerAddress ?? "",
    items: itemRows.map((row) => ({
      uid: row.id,
      lineType: row.lineType === "product" ? "product" : "option",
      code: row.code ?? "",
      name: row.name,
      spec: row.spec ?? "",
      unit: row.unit ?? "개",
      qty: row.qty ?? "",
      price: row.price ?? "",
      supplyOverride: row.supplyOverride ?? "",
    })),
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

  return {
    invoiceNumber: row.invoiceNumber,
    statementId: row.statementId,
    customerName: row.customerName,
    customerBusinessNumber: row.customerBusinessNumber ?? "",
    customerCeoName: row.customerCeoName ?? "",
    customerAddress: row.customerAddress ?? "",
    customerBusinessType: row.customerBusinessType ?? "",
    customerBusinessItem: row.customerBusinessItem ?? "",
    scheduledDate: row.scheduledDate ?? "",
    note: row.note ?? "",
    hometaxSent: row.hometaxSent,
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
    })),
  };
}

export async function requestTaxInvoice(projectId: string, draft: TaxInvoiceDraft): Promise<{ id: string }> {
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

  // 세금계산서는 거래명세서가 발송된 뒤에만 요청할 수 있다 (6. 거래명세서 발송 완료 이후).
  await assertProjectReachedStage(projectId, "statement_sent");

  const [created] = await db
    .insert(taxInvoices)
    .values({
      projectId,
      statementId: draft.statementId,
      invoiceNumber,
      customerName: draft.customerName.trim(),
      customerBusinessNumber: draft.customerBusinessNumber.trim() || null,
      customerCeoName: draft.customerCeoName.trim() || null,
      customerAddress: draft.customerAddress.trim() || null,
      customerBusinessType: draft.customerBusinessType.trim() || null,
      customerBusinessItem: draft.customerBusinessItem.trim() || null,
      status: "requested",
      scheduledDate: draft.scheduledDate || null,
      hometaxSent: draft.hometaxSent,
      note: draft.note || null,
      requestedBy: session.userId,
    })
    .returning({ id: taxInvoices.id });

  const itemsToInsert = draft.items
    .filter((it) => it.name.trim() !== "")
    .map((it, idx) => ({
      taxInvoiceId: created.id,
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

  return { id: created.id };
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

  return result;
}
