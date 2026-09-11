import type { QuoteItemDraft } from "@/lib/quotes/types";

// tax_invoice_items도 statement_items/po_items/quote_items와 구조가 같아 재사용한다.
export type TaxInvoiceItemDraft = QuoteItemDraft;

export type TaxInvoiceStatus = "requested" | "confirmed" | "issued";

export type TaxInvoiceDraft = {
  invoiceNumber: string;
  statementId: string | null;
  customerName: string;
  // 사업자등록증 정보 — 거래명세서 발송 뒤에 늦게 받는 경우가 많아 선택 입력이다.
  // 등록번호/주소는 저장 시 연결된 거래명세서에도 함께 반영된다.
  customerBusinessNumber: string;
  customerCeoName: string;
  customerAddress: string;
  customerBusinessType: string;
  customerBusinessItem: string;
  scheduledDate: string;
  note: string;
  hometaxSent: boolean;
  items: TaxInvoiceItemDraft[];
};

export type TaxInvoiceSummary = {
  id: string;
  invoiceNumber: string;
  customerName: string;
  status: TaxInvoiceStatus;
  scheduledDate: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  issuedAt: string | null;
  itemCount: number;
};

export type ImportableStatement = {
  id: string;
  statementNumber: string;
  customerName: string;
  statementDate: string;
  itemCount: number;
};
