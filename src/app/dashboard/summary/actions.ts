"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { summaryOverrides } from "@/db/schema";
import { getSession } from "@/lib/auth/session";

async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  return session;
}

export type SummaryOverrideFields = {
  orderDate: string;
  contactName: string;
  customerName: string;
  contactPhone: string;
  productCode: string;
  productName: string;
  qty: string;
  reqDate: string;
  supplierName: string;
  supplierPhone: string;
  shipDate: string;
};

// 견적서/발주서는 실제로 고객·공급업체에 보낸 문서라 원본이 그대로 남아야 한다
// (2026-09-03) — 그래서 Summary에서 셀을 고치면 quotes/quote_items/purchase_orders/
// production 원본을 직접 UPDATE하지 않고, "화면에 보여줄 현재 값"만 이 테이블에 따로
// 기록한다. 원본은 그대로, Summary/대시보드가 보여주는 값만 바뀐다.
export async function updateSummaryOverride(rowKey: string, fields: Partial<SummaryOverrideFields>): Promise<void> {
  const session = await requireSession();

  const patch: Partial<typeof summaryOverrides.$inferInsert> = {};
  if (fields.orderDate !== undefined) patch.orderDate = fields.orderDate.trim() || null;
  if (fields.contactName !== undefined) patch.contactName = fields.contactName.trim() || null;
  if (fields.customerName !== undefined) patch.customerName = fields.customerName.trim() || null;
  if (fields.contactPhone !== undefined) patch.contactPhone = fields.contactPhone.trim() || null;
  if (fields.productCode !== undefined) patch.productCode = fields.productCode.trim() || null;
  if (fields.productName !== undefined) patch.productName = fields.productName.trim() || null;
  if (fields.qty !== undefined) patch.qty = fields.qty.trim() || null;
  if (fields.reqDate !== undefined) patch.reqDate = fields.reqDate.trim() || null;
  if (fields.supplierName !== undefined) patch.supplierName = fields.supplierName.trim() || null;
  if (fields.supplierPhone !== undefined) patch.supplierPhone = fields.supplierPhone.trim() || null;
  if (fields.shipDate !== undefined) patch.shipDate = fields.shipDate.trim() || null;

  await db
    .insert(summaryOverrides)
    .values({ rowKey, ...patch, updatedBy: session.userId })
    .onConflictDoUpdate({
      target: summaryOverrides.rowKey,
      set: { ...patch, updatedAt: new Date(), updatedBy: session.userId },
    });
}
