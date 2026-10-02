"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dailySummaryEntries } from "@/db/schema";
import { getSession, requireAdmin } from "@/lib/auth/session";
import { recordDeletion } from "@/lib/audit/deletion-log";

async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  return session;
}

export type DailySummaryEntryFields = {
  division: string;
  orderDate: string;
  contactName: string;
  customerName: string;
  contactOffice: string;
  contactMobile: string;
  productCode: string;
  productName: string;
  qty: string;
  reqDate: string;
  supplierName: string;
  supplierPhone: string;
  shipDate: string;
  note: string;
  paidCash: string;
  paidCard: string;
  outAmount: string;
  cashReceiptDate: string;
  taxInvoiceDate: string;
};

function toPatch(fields: Partial<DailySummaryEntryFields>): Partial<typeof dailySummaryEntries.$inferInsert> {
  const patch: Partial<typeof dailySummaryEntries.$inferInsert> = {};
  if (fields.division !== undefined) patch.division = fields.division.trim() || null;
  if (fields.orderDate !== undefined) patch.orderDate = fields.orderDate.trim() || null;
  if (fields.contactName !== undefined) patch.contactName = fields.contactName.trim() || null;
  if (fields.customerName !== undefined) patch.customerName = fields.customerName.trim() || null;
  if (fields.contactOffice !== undefined) patch.contactOffice = fields.contactOffice.trim() || null;
  if (fields.contactMobile !== undefined) patch.contactMobile = fields.contactMobile.trim() || null;
  if (fields.productCode !== undefined) patch.productCode = fields.productCode.trim() || null;
  if (fields.productName !== undefined) patch.productName = fields.productName.trim() || null;
  if (fields.qty !== undefined) patch.qty = fields.qty.trim() || null;
  if (fields.reqDate !== undefined) patch.reqDate = fields.reqDate.trim() || null;
  if (fields.supplierName !== undefined) patch.supplierName = fields.supplierName.trim() || null;
  if (fields.supplierPhone !== undefined) patch.supplierPhone = fields.supplierPhone.trim() || null;
  if (fields.shipDate !== undefined) patch.shipDate = fields.shipDate.trim() || null;
  if (fields.note !== undefined) patch.note = fields.note.trim() || null;
  if (fields.paidCash !== undefined) patch.paidCash = fields.paidCash.trim() || null;
  if (fields.paidCard !== undefined) patch.paidCard = fields.paidCard.trim() || null;
  if (fields.outAmount !== undefined) patch.outAmount = fields.outAmount.trim() || null;
  if (fields.cashReceiptDate !== undefined) patch.cashReceiptDate = fields.cashReceiptDate.trim() || null;
  if (fields.taxInvoiceDate !== undefined) patch.taxInvoiceDate = fields.taxInvoiceDate.trim() || null;
  return patch;
}

// 새 행 추가 — 항상 source="manual"(화면에서 직접 입력). 엑셀 이관 행(source="excel")은
// scripts/import-daily-summary-full.ts로만 채워진다.
export async function addDailySummaryEntry(fields: Partial<DailySummaryEntryFields>): Promise<{ id: string }> {
  const session = await requireSession();
  const [row] = await db
    .insert(dailySummaryEntries)
    .values({ source: "manual", updatedBy: session.userId, ...toPatch(fields) })
    .returning({ id: dailySummaryEntries.id });
  return row;
}

// 이 테이블의 행(엑셀 이관 + 수기 입력)은 어떤 견적서/발주서처럼 고객·공급업체에 실제로
// 보낸 문서가 아니라 이 화면만의 기록이므로, summary_overrides 같은 그림자 테이블 없이
// 바로 UPDATE한다.
export async function updateDailySummaryEntry(id: string, fields: Partial<DailySummaryEntryFields>): Promise<void> {
  const session = await requireSession();
  const patch = toPatch(fields);
  await db
    .update(dailySummaryEntries)
    .set({ ...patch, updatedAt: new Date(), updatedBy: session.userId })
    .where(eq(dailySummaryEntries.id, id));
}

// 관리자만 가능하고 삭제 이력을 남긴다(2026-09-29).
export async function deleteDailySummaryEntry(id: string): Promise<void> {
  const session = await requireAdmin();
  const [row] = await db
    .select({ customerName: dailySummaryEntries.customerName, productName: dailySummaryEntries.productName })
    .from(dailySummaryEntries)
    .where(eq(dailySummaryEntries.id, id))
    .limit(1);
  await db.delete(dailySummaryEntries).where(eq(dailySummaryEntries.id, id));
  if (row) {
    await recordDeletion(
      session,
      "daily_summary_entry",
      `${row.customerName ?? "(고객명 없음)"} · ${row.productName ?? "(상품명 없음)"}`,
      { entryId: id }
    );
  }
}
