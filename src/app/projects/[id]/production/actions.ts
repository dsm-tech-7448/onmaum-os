"use server";

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { production, notificationLog, purchaseOrders } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { advanceProjectStage, assertProjectReachedStage } from "@/lib/projects/stage-transition";
import type {
  ImportablePurchaseOrder,
  ProductionDraft,
  ProductionSummary,
  NotificationLogSummary,
} from "@/lib/production/types";

async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  return session;
}

// 아직 배송건이 안 붙은 발주서만 "불러오기" 대상으로 보여준다 — 이미 송장을 등록한
// 발주서는 배송건 목록에서 직접 수정하면 된다.
export async function listImportablePurchaseOrders(projectId: string): Promise<ImportablePurchaseOrder[]> {
  await requireSession();

  const rows = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      revision: purchaseOrders.revision,
      supplierName: purchaseOrders.supplierName,
      reqDate: purchaseOrders.reqDate,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.projectId, projectId))
    .orderBy(desc(purchaseOrders.revision));

  const linkedRows = await db
    .select({ poId: production.poId })
    .from(production)
    .where(and(eq(production.projectId, projectId), isNotNull(production.poId)));
  const linkedIds = new Set(linkedRows.map((r) => r.poId));

  const latestByNumber = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestByNumber.has(row.poNumber)) latestByNumber.set(row.poNumber, row);
  }

  return Array.from(latestByNumber.values())
    .filter((r) => !linkedIds.has(r.id))
    .sort((a, b) => b.poNumber.localeCompare(a.poNumber))
    .map((r) => ({
      id: r.id,
      poNumber: r.poNumber,
      latestRevision: r.revision,
      supplierName: r.supplierName,
      reqDate: r.reqDate,
    }));
}

export async function listProduction(projectId: string): Promise<ProductionSummary[]> {
  await requireSession();

  const rows = await db
    .select({
      id: production.id,
      poId: production.poId,
      carrier: production.carrier,
      trackingNumber: production.trackingNumber,
      actualShipDate: production.actualShipDate,
      customerNotifiedAt: production.customerNotifiedAt,
      note: production.note,
      updatedAt: production.updatedAt,
      poNumber: purchaseOrders.poNumber,
      reqDate: purchaseOrders.reqDate,
      supplierName: purchaseOrders.supplierName,
    })
    .from(production)
    .leftJoin(purchaseOrders, eq(production.poId, purchaseOrders.id))
    .where(eq(production.projectId, projectId))
    .orderBy(desc(production.updatedAt));

  return rows.map((r) => ({
    id: r.id,
    poId: r.poId,
    poNumber: r.poNumber,
    reqDate: r.reqDate,
    supplierName: r.supplierName,
    carrier: r.carrier,
    trackingNumber: r.trackingNumber,
    actualShipDate: r.actualShipDate,
    customerNotifiedAt: r.customerNotifiedAt ? r.customerNotifiedAt.toISOString() : null,
    note: r.note,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function listNotifications(projectId: string): Promise<NotificationLogSummary[]> {
  await requireSession();

  const rows = await db
    .select()
    .from(notificationLog)
    .where(eq(notificationLog.projectId, projectId))
    .orderBy(desc(notificationLog.createdAt));

  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    type: r.type,
    messageContent: r.messageContent,
    status: r.status,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}


export type SaveProductionResult = { id: string; notified: boolean; stageAdvanced: boolean };

// 고객 통보를 체크했을 때 프로젝트를 "8. 배송일정 안내"로 넘긴다 — 단, 세금계산서 발행(7단계)이
// 끝난 프로젝트만. 아직 거기까지 안 온 프로젝트는 통보 체크만 기록하고 단계는 건드리지 않는다
// (안 그러면 대시보드의 세금계산서 발행 필요 등이 사라진다).
async function advanceToShippingNotifiedIfReady(projectId: string, userId: string): Promise<boolean> {
  try {
    await assertProjectReachedStage(projectId, "tax_invoice_issued");
  } catch {
    return false;
  }
  const { advanced } = await advanceProjectStage(projectId, "shipping_notified", userId);
  return advanced;
}

export async function saveProduction(
  projectId: string,
  draft: ProductionDraft
): Promise<SaveProductionResult> {
  const session = await requireSession();

  if (!draft.poId) throw new Error("어느 발주서에 대한 배송인지 먼저 선택해주세요.");

  let existing: typeof production.$inferSelect | undefined;
  if (draft.id) {
    [existing] = await db.select().from(production).where(eq(production.id, draft.id)).limit(1);
  }
  const isNewlyNotified = draft.customerNotified && !existing?.customerNotifiedAt;

  const values = {
    projectId,
    poId: draft.poId,
    carrier: draft.carrier || null,
    trackingNumber: draft.trackingNumber.trim() || null,
    actualShipDate: draft.actualShipDate || null,
    customerNotifiedAt: draft.customerNotified ? (existing?.customerNotifiedAt ?? new Date()) : null,
    note: draft.note || null,
    updatedAt: new Date(),
  };

  let savedId: string;
  if (existing) {
    await db.update(production).set(values).where(eq(production.id, existing.id));
    savedId = existing.id;
  } else {
    const [created] = await db
      .insert(production)
      .values({ ...values, createdBy: session.userId })
      .returning({ id: production.id });
    savedId = created.id;
  }

  const stageAdvanced = isNewlyNotified ? await advanceToShippingNotifiedIfReady(projectId, session.userId) : false;
  return { id: savedId, notified: isNewlyNotified, stageAdvanced };
}

// 대시보드 "출고 예정" 목록에서 발주서 한 건의 고객 통보 여부를 바로 체크/해제한다 — 배송건이
// 아직 없으면 만들고, 있으면 통보 시각만 갱신한다.
export async function setPoCustomerNotified(poId: string, notified: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "로그인이 필요합니다." };

  const [po] = await db
    .select({ id: purchaseOrders.id, projectId: purchaseOrders.projectId })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, poId))
    .limit(1);
  if (!po) return { ok: false, error: "발주서를 찾을 수 없습니다." };

  const [existing] = await db.select().from(production).where(eq(production.poId, poId)).limit(1);
  const now = new Date();
  if (existing) {
    await db
      .update(production)
      .set({ customerNotifiedAt: notified ? (existing.customerNotifiedAt ?? now) : null, updatedAt: now })
      .where(eq(production.id, existing.id));
  } else if (notified) {
    await db
      .insert(production)
      .values({ projectId: po.projectId, poId, customerNotifiedAt: now, createdBy: session.userId });
  }

  if (notified && !existing?.customerNotifiedAt) {
    await advanceToShippingNotifiedIfReady(po.projectId, session.userId);
  }
  return { ok: true };
}
