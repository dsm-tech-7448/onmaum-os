import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  customers,
  projectStages,
  projectStageLog,
  purchaseOrders,
  poItems,
  transactionStatements,
  production,
  taxInvoices,
  notificationLog,
  projectRequests,
  summaryOverrides,
} from "@/db/schema";
import { getNextStage } from "@/lib/projects/stage-transition";

// drafts/actions.ts의 DRAFT_SENT_TYPE과 반드시 같은 문자열이어야 한다("use server" 파일은
// 함수 외 값을 export할 수 없어 상수를 공유하지 못하고 여기서 그대로 반복한다).
const DRAFT_SENT_TYPE = "시안발송";

// 이 기간 이상 같은 단계에 머물면 "지연 의심"으로 본다 — project_stage_log가 이 용도로
// 이미 설계돼 있었다("3일 이상 같은 단계에 머무름 = 지연 의심" 스키마 주석 참고).
// 우선 7일로 통일해서 시작하고, 필요하면 단계별로 나중에 나눈다.
const STALL_THRESHOLD_DAYS = 7;
const LAST_STAGE_SORT_ORDER = 8; // 배송일정 안내 — 마지막 단계라 대상에서 제외

export type StalledProject = {
  projectId: string;
  projectNumber: string;
  customerName: string;
  stageName: string;
  daysInStage: number;
};

export async function getStalledProjects(): Promise<StalledProject[]> {
  const rows = await db
    .select({
      projectId: projects.id,
      projectNumber: projects.projectNumber,
      customerName: customers.companyName,
      currentStageId: projects.currentStageId,
      stageName: projectStages.stageName,
      stageSortOrder: projectStages.sortOrder,
    })
    .from(projects)
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .leftJoin(projectStages, eq(projects.currentStageId, projectStages.id));

  const active = rows.filter((r) => r.currentStageId && (r.stageSortOrder ?? 0) < LAST_STAGE_SORT_ORDER);
  if (active.length === 0) return [];

  const logRows = await db
    .select({
      projectId: projectStageLog.projectId,
      stageId: projectStageLog.stageId,
      reachedAt: projectStageLog.reachedAt,
    })
    .from(projectStageLog)
    .where(
      inArray(
        projectStageLog.projectId,
        active.map((r) => r.projectId)
      )
    );

  // 프로젝트별로 "현재 단계에 도달한 시각" = (projectId, currentStageId)와 일치하는 로그 중 최신.
  const reachedAtByProject = new Map<string, Date>();
  for (const log of logRows) {
    const key = `${log.projectId}:${log.stageId}`;
    const project = active.find((r) => r.projectId === log.projectId && r.currentStageId === log.stageId);
    if (!project) continue;
    const existing = reachedAtByProject.get(key);
    if (!existing || log.reachedAt > existing) reachedAtByProject.set(key, log.reachedAt);
  }

  const now = Date.now();
  const stalled: StalledProject[] = [];
  for (const r of active) {
    const reachedAt = reachedAtByProject.get(`${r.projectId}:${r.currentStageId}`);
    if (!reachedAt) continue; // 이력 없으면(시드 직후 등) 판단 보류
    const daysInStage = Math.floor((now - reachedAt.getTime()) / (1000 * 60 * 60 * 24));
    if (daysInStage >= STALL_THRESHOLD_DAYS) {
      stalled.push({
        projectId: r.projectId,
        projectNumber: r.projectNumber,
        customerName: r.customerName,
        stageName: r.stageName ?? "-",
        daysInStage,
      });
    }
  }

  return stalled.sort((a, b) => b.daysInStage - a.daysInStage);
}

export type OverdueUnshippedPo = {
  projectId: string;
  projectNumber: string;
  customerName: string;
  poNumber: string;
  supplierName: string;
  reqDate: string;
};

// 발송요청일이 matchesDate 조건에 맞는데 아직 송장번호가 없는 발주 — 오늘 확인해야 할
// 발주(getPOsDueToday)와 이미 지났는데 안 된 발주(getOverdueUnshippedPos)가 조회 로직은
// 같고 날짜 비교 조건만 달라 공유한다. 발송요청일은 Summary에서 정정했을 수 있어
// (summary_overrides) 원본 purchase_orders.req_date만으로 SQL WHERE를 걸 수 없다 —
// 후보를 다 가져온 뒤 정정값을 반영한 "현재 유효한" 발송요청일 기준으로 JS에서 비교한다.
async function getUnshippedPosWhere(matchesDate: (reqDate: string) => boolean): Promise<OverdueUnshippedPo[]> {
  const rows = await db
    .select({
      id: purchaseOrders.id,
      projectId: purchaseOrders.projectId,
      poNumber: purchaseOrders.poNumber,
      revision: purchaseOrders.revision,
      quoteItemId: purchaseOrders.quoteItemId,
      supplierName: purchaseOrders.supplierName,
      reqDate: purchaseOrders.reqDate,
      projectNumber: projects.projectNumber,
      customerName: customers.companyName,
    })
    .from(purchaseOrders)
    .innerJoin(projects, eq(purchaseOrders.projectId, projects.id))
    .innerJoin(customers, eq(projects.customerId, customers.id));

  if (rows.length === 0) return [];

  // 같은 발주번호는 최신 리비전만 본다.
  const latestByNumber = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.projectId}:${row.poNumber}`;
    const existing = latestByNumber.get(key);
    if (!existing || row.revision > existing.revision) latestByNumber.set(key, row);
  }
  const candidates = Array.from(latestByNumber.values());

  // summary-sheet.ts의 SummaryRow.rowKey와 같은 규칙(견적 품목에 매칭되면 그 id, 아니면
  // po-{poId})으로 정정값을 찾는다.
  const overrideRows = await db
    .select({ rowKey: summaryOverrides.rowKey, reqDate: summaryOverrides.reqDate })
    .from(summaryOverrides)
    .where(
      inArray(
        summaryOverrides.rowKey,
        candidates.map((c) => c.quoteItemId ?? `po-${c.id}`)
      )
    );
  const overrideReqDateByRowKey = new Map(overrideRows.map((o) => [o.rowKey, o.reqDate]));

  const shippedRows = await db
    .select({ poId: production.poId, trackingNumber: production.trackingNumber })
    .from(production)
    .where(
      inArray(
        production.poId,
        candidates.map((c) => c.id)
      )
    );
  const shippedPoIds = new Set(
    shippedRows.filter((s) => s.poId && s.trackingNumber?.trim()).map((s) => s.poId as string)
  );

  return candidates
    .filter((c) => !shippedPoIds.has(c.id))
    .map((c) => {
      const rowKey = c.quoteItemId ?? `po-${c.id}`;
      const effectiveReqDate = overrideReqDateByRowKey.get(rowKey) || c.reqDate || "";
      return {
        projectId: c.projectId,
        projectNumber: c.projectNumber,
        customerName: c.customerName,
        poNumber: c.poNumber,
        supplierName: c.supplierName,
        reqDate: effectiveReqDate,
      };
    })
    .filter((c) => c.reqDate && matchesDate(c.reqDate))
    .sort((a, b) => a.reqDate.localeCompare(b.reqDate));
}

export async function getOverdueUnshippedPos(): Promise<OverdueUnshippedPo[]> {
  const today = new Date().toISOString().slice(0, 10);
  return getUnshippedPosWhere((reqDate) => reqDate < today);
}

// 발송요청일이 오늘인 발주 — 공급업체에 당일 실제 출고되는지 직접 확인해야 하는 건.
export async function getPOsDueToday(): Promise<OverdueUnshippedPo[]> {
  const today = new Date().toISOString().slice(0, 10);
  return getUnshippedPosWhere((reqDate) => reqDate === today);
}

export type BlockedTaxInvoice = {
  projectId: string;
  projectNumber: string;
  customerName: string;
  invoiceNumber: string;
  status: string;
};

export async function getBlockedTaxInvoices(): Promise<BlockedTaxInvoice[]> {
  const rows = await db
    .select({
      projectId: taxInvoices.projectId,
      invoiceNumber: taxInvoices.invoiceNumber,
      status: taxInvoices.status,
      customerBusinessNumber: taxInvoices.customerBusinessNumber,
      projectNumber: projects.projectNumber,
      customerName: customers.companyName,
    })
    .from(taxInvoices)
    .innerJoin(projects, eq(taxInvoices.projectId, projects.id))
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .where(
      and(
        or(eq(taxInvoices.status, "requested"), eq(taxInvoices.status, "confirmed")),
        or(isNull(taxInvoices.customerBusinessNumber), eq(taxInvoices.customerBusinessNumber, ""))
      )
    )
    .orderBy(desc(taxInvoices.requestedAt));

  return rows.map((r) => ({
    projectId: r.projectId,
    projectNumber: r.projectNumber,
    customerName: r.customerName,
    invoiceNumber: r.invoiceNumber,
    status: r.status,
  }));
}

// ── 여기부터 "지금 처리해야 할 것" 체크리스트 확장 (2026-09-03) ──────────────────

export type PendingStageGroup = {
  stageSortOrder: number;
  stageName: string;
  projects: { projectId: string; projectNumber: string; customerName: string }[];
};

// 8단계 미만인 모든 활성 프로젝트를 getNextStage() 기준으로 그룹핑한다 — 정체 임계값
// 없이 즉시 표시(견적서 발송/시안 작성/발주서 작성/거래명세서 작성/영수증 발행을 이
// 하나의 함수로 커버). getStalledProjects()와 달리 "얼마나 오래 걸렸는지"는 안 본다.
export async function getProjectsByPendingStage(): Promise<PendingStageGroup[]> {
  const stages = await db.select().from(projectStages).orderBy(projectStages.sortOrder);

  const rows = await db
    .select({
      projectId: projects.id,
      projectNumber: projects.projectNumber,
      customerName: customers.companyName,
      requiresDraft: projects.requiresDraft,
      currentStageSortOrder: projectStages.sortOrder,
    })
    .from(projects)
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .leftJoin(projectStages, eq(projects.currentStageId, projectStages.id));

  const groups = new Map<string, PendingStageGroup>();
  for (const r of rows) {
    const next = getNextStage(stages, r.currentStageSortOrder, r.requiresDraft);
    if (!next) continue; // 이미 마지막 단계

    const group = groups.get(next.stageCode) ?? {
      stageSortOrder: next.sortOrder,
      stageName: next.stageName,
      projects: [],
    };
    group.projects.push({ projectId: r.projectId, projectNumber: r.projectNumber, customerName: r.customerName });
    groups.set(next.stageCode, group);
  }

  return Array.from(groups.values()).sort((a, b) => a.stageSortOrder - b.stageSortOrder);
}

export type UnsentDraft = { projectId: string; projectNumber: string; customerName: string };

// 시안 발송은 진행 단계를 막지 않는 별도 액션이라 위 그룹핑에 안 잡힌다 — 시안이 필요한
// 프로젝트가 3단계(인쇄 시안 작성중) 이상 진행됐는데 notificationLog에 "시안발송" 기록이
// 하나도 없으면 표시한다.
export async function getUnsentDrafts(): Promise<UnsentDraft[]> {
  const rows = await db
    .select({
      projectId: projects.id,
      projectNumber: projects.projectNumber,
      customerName: customers.companyName,
      currentStageSortOrder: projectStages.sortOrder,
    })
    .from(projects)
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .leftJoin(projectStages, eq(projects.currentStageId, projectStages.id))
    .where(eq(projects.requiresDraft, true));

  const candidates = rows.filter((r) => (r.currentStageSortOrder ?? 0) >= 3);
  if (candidates.length === 0) return [];

  const sentLogs = await db
    .select({ projectId: notificationLog.projectId })
    .from(notificationLog)
    .where(
      and(
        inArray(
          notificationLog.projectId,
          candidates.map((c) => c.projectId)
        ),
        eq(notificationLog.type, DRAFT_SENT_TYPE)
      )
    );
  const sentSet = new Set(sentLogs.map((s) => s.projectId));

  return candidates
    .filter((c) => !sentSet.has(c.projectId))
    .map((c) => ({ projectId: c.projectId, projectNumber: c.projectNumber, customerName: c.customerName }));
}

export type UnpaidSupplier = {
  projectId: string;
  projectNumber: string;
  customerName: string;
  poNumber: string;
  supplierName: string;
  amount: number;
};

export async function getUnpaidSuppliers(): Promise<UnpaidSupplier[]> {
  const rows = await db
    .select({
      id: purchaseOrders.id,
      projectId: purchaseOrders.projectId,
      poNumber: purchaseOrders.poNumber,
      revision: purchaseOrders.revision,
      supplierName: purchaseOrders.supplierName,
      paidAmount: purchaseOrders.paidAmount,
      projectNumber: projects.projectNumber,
      customerName: customers.companyName,
    })
    .from(purchaseOrders)
    .innerJoin(projects, eq(purchaseOrders.projectId, projects.id))
    .innerJoin(customers, eq(projects.customerId, customers.id));

  const latestByKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.projectId}:${row.poNumber}`;
    const existing = latestByKey.get(key);
    if (!existing || row.revision > existing.revision) latestByKey.set(key, row);
  }
  const candidates = Array.from(latestByKey.values()).filter((r) => r.paidAmount == null);
  if (candidates.length === 0) return [];

  const items = await db
    .select({ poId: poItems.poId, qty: poItems.qty, price: poItems.price })
    .from(poItems)
    .where(
      inArray(
        poItems.poId,
        candidates.map((c) => c.id)
      )
    );
  const amountByPo = new Map<string, number>();
  for (const it of items) {
    amountByPo.set(it.poId, (amountByPo.get(it.poId) ?? 0) + Number(it.qty ?? 0) * Number(it.price ?? 0));
  }

  return candidates.map((c) => ({
    projectId: c.projectId,
    projectNumber: c.projectNumber,
    customerName: c.customerName,
    poNumber: c.poNumber,
    supplierName: c.supplierName,
    amount: amountByPo.get(c.id) ?? 0,
  }));
}

export type MissingCustomerPayment = {
  projectId: string;
  projectNumber: string;
  customerName: string;
  statementNumber: string;
};

export async function getMissingCustomerPayments(): Promise<MissingCustomerPayment[]> {
  const rows = await db
    .select({
      projectId: transactionStatements.projectId,
      statementNumber: transactionStatements.statementNumber,
      projectNumber: projects.projectNumber,
      customerName: customers.companyName,
    })
    .from(transactionStatements)
    .innerJoin(projects, eq(transactionStatements.projectId, projects.id))
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .where(and(isNull(transactionStatements.paidCash), isNull(transactionStatements.paidCard)));

  return rows;
}

export type OutstandingBalance = {
  projectId: string;
  projectNumber: string;
  customerName: string;
  statementNumber: string;
  outstandingAmount: number;
};

export async function getOutstandingBalances(): Promise<OutstandingBalance[]> {
  const rows = await db
    .select({
      projectId: transactionStatements.projectId,
      statementNumber: transactionStatements.statementNumber,
      outstandingAmount: transactionStatements.outstandingAmount,
      projectNumber: projects.projectNumber,
      customerName: customers.companyName,
    })
    .from(transactionStatements)
    .innerJoin(projects, eq(transactionStatements.projectId, projects.id))
    .innerJoin(customers, eq(projects.customerId, customers.id));

  return rows
    .filter((r) => r.outstandingAmount != null && Number(r.outstandingAmount) > 0)
    .map((r) => ({
      projectId: r.projectId,
      projectNumber: r.projectNumber,
      customerName: r.customerName,
      statementNumber: r.statementNumber,
      outstandingAmount: Number(r.outstandingAmount),
    }));
}

export type UnresolvedRequest = {
  projectId: string;
  projectNumber: string;
  customerName: string;
  source: string;
  content: string;
  requestedAt: string;
};

export async function getUnresolvedRequests(): Promise<UnresolvedRequest[]> {
  const rows = await db
    .select({
      projectId: projectRequests.projectId,
      source: projectRequests.source,
      content: projectRequests.content,
      requestedAt: projectRequests.requestedAt,
      projectNumber: projects.projectNumber,
      customerName: customers.companyName,
    })
    .from(projectRequests)
    .innerJoin(projects, eq(projectRequests.projectId, projects.id))
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .where(isNull(projectRequests.resolvedAt))
    .orderBy(desc(projectRequests.requestedAt));

  return rows.map((r) => ({
    projectId: r.projectId,
    projectNumber: r.projectNumber,
    customerName: r.customerName,
    source: r.source,
    content: r.content,
    requestedAt: r.requestedAt.toISOString(),
  }));
}

export type MissingPurchaseOrder = { projectId: string; projectNumber: string; customerName: string };

// 발주서가 아예 없는 활성 프로젝트 — "발주서 작성" 카드용. 고객 요청으로 거래명세서를
// 발주보다 먼저 보내는 경우(saveStatement의 단계 관문을 "견적 발송" 이후로 완화했다)
// 프로젝트 진행 단계가 이미 6단계(거래명세서 발송) 이후로 넘어가 있을 수 있어, 진행
// 단계만으로는 "발주서를 아직 안 만들었다"를 알 수 없다 — 그래서 발주서 존재 여부를
// 직접 확인한다(getProjectsByPendingStage의 "다음 단계=5" 방식 대신).
export async function getProjectsMissingPO(): Promise<MissingPurchaseOrder[]> {
  const rows = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      customerName: customers.companyName,
      stageSortOrder: projectStages.sortOrder,
    })
    .from(projects)
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .leftJoin(projectStages, eq(projects.currentStageId, projectStages.id));

  const active = rows.filter((r) => (r.stageSortOrder ?? 0) < LAST_STAGE_SORT_ORDER);
  if (active.length === 0) return [];

  const poRows = await db
    .select({ projectId: purchaseOrders.projectId })
    .from(purchaseOrders)
    .where(
      inArray(
        purchaseOrders.projectId,
        active.map((r) => r.id)
      )
    );
  const hasPo = new Set(poRows.map((r) => r.projectId));

  return active
    .filter((r) => !hasPo.has(r.id))
    .map((r) => ({ projectId: r.id, projectNumber: r.projectNumber, customerName: r.customerName }));
}

export type UpcomingPeakSeasonCustomer = {
  customerId: string;
  companyName: string;
  peakSeasonMonth: number;
  contactName: string | null;
  mobilePhone: string | null;
  officePhone: string | null;
};

// 개인 성수기가 "다음 달"인 고객 — 온마음OS_시즌분석_고객등급_알림전략.md의 "고객별 과거
// 주문월 1개월 전 리마인드" 설계. peak_season_month는 scripts/compute-peak-season.ts가
// historical_orders(Daily Summary 이력, 기준정보) 기준으로 미리 계산해 customers에 저장해둔
// 값이다 — 이 쿼리는 그 값을 오늘 날짜 기준으로 걸러서 보여주기만 한다.
export async function getUpcomingPeakSeasonCustomers(): Promise<UpcomingPeakSeasonCustomer[]> {
  const currentMonth = new Date().getMonth() + 1; // 1~12
  const nextMonth = (currentMonth % 12) + 1;

  const rows = await db
    .select({
      id: customers.id,
      companyName: customers.companyName,
      peakSeasonMonth: customers.peakSeasonMonth,
      contactName: customers.contactName,
      mobilePhone: customers.mobilePhone,
      officePhone: customers.officePhone,
    })
    .from(customers)
    .where(eq(customers.peakSeasonMonth, nextMonth));

  return rows
    .map((r) => ({
      customerId: r.id,
      companyName: r.companyName,
      peakSeasonMonth: r.peakSeasonMonth!,
      contactName: r.contactName,
      mobilePhone: r.mobilePhone,
      officePhone: r.officePhone,
    }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));
}
