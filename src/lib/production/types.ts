export type ProductionDraft = {
  id: string | null; // null이면 새 배송건
  poId: string | null;
  carrier: string;
  trackingNumber: string;
  actualShipDate: string;
  customerNotified: boolean; // 고객에게 발송 통보했는지(체크만 — 알림톡 아님)
  note: string;
};

export type ProductionSummary = {
  id: string;
  poId: string | null;
  poNumber: string | null;
  reqDate: string | null; // 발주서의 발송요청일 — 참고용
  supplierName: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  actualShipDate: string | null;
  customerNotifiedAt: string | null;
  note: string | null;
  updatedAt: string;
};

export type ImportablePurchaseOrder = {
  id: string;
  poNumber: string;
  latestRevision: number;
  supplierName: string;
  reqDate: string | null;
};

export type { NotificationLogSummary } from "@/lib/notifications/types";
