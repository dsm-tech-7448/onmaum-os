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
import { issueTaxInvoiceViaPopbill, sendTaxInvoiceEmailViaPopbill } from "@/lib/popbill/tax-invoice";
import { isPopbillConfigured } from "@/lib/popbill/client";
import { mergeToSingleItem } from "@/lib/tax-invoices/merge-items";
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

  // 거래명세서 품목이 몇 줄이든 세금계산서엔 품명 하나로 합쳐서 가져온다(2026-09-22).
  const merged = mergeToSingleItem(itemRows);

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
              supplyOverride: merged.supply ? String(Math.round(merged.supply)) : "",
              taxOverride: merged.tax ? String(Math.round(merged.tax)) : "",
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

export type SendTaxInvoiceEmailResult = { ok: true } | { ok: false; error: string };

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

  const result = await sendTaxInvoiceEmailViaPopbill(row.invoiceNumber, email.trim());
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
