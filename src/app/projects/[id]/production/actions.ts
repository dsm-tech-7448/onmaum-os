"use server";

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { production, notificationLog, projects, customers, purchaseOrders } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { advanceProjectStage, assertProjectReachedStage } from "@/lib/projects/stage-transition";
import { isAlimtalkConfigured, sendShippingAlimtalk } from "@/lib/popbill/kakao";
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

export type SaveProductionResult = { id: string; notified: boolean };

export async function saveProduction(
  projectId: string,
  draft: ProductionDraft
): Promise<SaveProductionResult> {
  const session = await requireSession();

  if (!draft.poId) throw new Error("어느 발주서에 대한 배송인지 먼저 선택해주세요.");

  const trackingNumber = draft.trackingNumber.trim();
  const hasTracking = trackingNumber !== "";

  let existing: typeof production.$inferSelect | undefined;
  if (draft.id) {
    [existing] = await db.select().from(production).where(eq(production.id, draft.id)).limit(1);
  }
  const hadTracking = !!existing?.trackingNumber?.trim();
  // 송장번호가 "이번에 처음" 채워지는 경우에만 알림 생성 + 단계 전환 (멱등 — 다시 저장해도 중복 안됨).
  const isNewlyTracked = hasTracking && !hadTracking;

  if (isNewlyTracked) {
    // 세금계산서 발행이 끝난 뒤에만 송장번호를 등록할 수 있다 (7. 세금계산서 발행 완료 이후).
    await assertProjectReachedStage(projectId, "tax_invoice_issued");
  }

  const values = {
    projectId,
    poId: draft.poId,
    carrier: draft.carrier || null,
    trackingNumber: trackingNumber || null,
    actualShipDate: draft.actualShipDate || null,
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

  if (isNewlyTracked) {
    const [project] = await db
      .select({ projectNumber: projects.projectNumber, customerId: projects.customerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (project) {
      const [customer] = await db
        .select({ companyName: customers.companyName, mobilePhone: customers.mobilePhone, contactName: customers.contactName })
        .from(customers)
        .where(eq(customers.id, project.customerId))
        .limit(1);

      const messageContent = `[${customer?.companyName ?? "고객"}] ${project.projectNumber} 주문하신 상품이 발송되었습니다. 택배사: ${
        draft.carrier || "미정"
      }, 송장번호: ${trackingNumber}`;

      // 알림톡 연동(2026-09-03 준비) — 팝빌 발신프로필/승인템플릿이 설정돼 있고 고객
      // 휴대폰번호가 있으면 실제 발송을 시도한다. content는 카카오에 사전승인된 템플릿
      // 문구와 정확히 일치해야 하므로, 실제 템플릿이 승인되면 위 messageContent 형식을
      // 그 문구에 맞게 조정해야 한다. 미설정/번호 없음이면 지금까지처럼 로그만 남긴다.
      let channel: "kakao" | "internal" = "internal";
      let status: "pending" | "sent" | "failed" = "pending";
      let sentAt: Date | null = null;
      if (isAlimtalkConfigured() && customer?.mobilePhone) {
        const sendResult = await sendShippingAlimtalk({
          content: messageContent,
          altContent: messageContent,
          receiver: customer.mobilePhone,
          receiverName: customer.contactName || customer.companyName || "고객",
        });
        channel = "kakao";
        status = sendResult.ok ? "sent" : "failed";
        sentAt = sendResult.ok ? new Date() : null;
      }

      await db.insert(notificationLog).values({
        customerId: project.customerId,
        projectId,
        channel,
        type: "배송일정안내",
        messageContent,
        status,
        sentAt,
      });
    }

    await advanceProjectStage(projectId, "shipping_notified", session.userId);
  }

  return { id: savedId, notified: isNewlyTracked };
}
