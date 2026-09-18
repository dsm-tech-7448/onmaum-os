import type { QuoteItemDraft } from "@/lib/quotes/types";

// po_items는 quote_items와 구조가 완전히 같아 QuoteItemDraft를 그대로 재사용한다.
export type PoItemDraft = QuoteItemDraft;

export type PoDraft = {
  id?: string; // 저장된 리비전을 불러왔을 때만 존재 — 입금 기록 등 단순 업데이트에 사용
  poNumber: string;
  quoteId: string | null;
  quoteItemId: string | null;
  supplierId: string | null;
  supplierName: string;
  supplierPhone: string;
  receiver: string;
  poDate: string;
  reqDate: string;
  payTerm: string;
  printNote: string;
  shipAddr: string;
  shipReceiver: string;
  note: string;
  requestNote: string;
  // 공급업체 입금(참고용) — 리비전 재저장과 무관하게 이 리비전 행에 직접 기록된다.
  paidAmount: string;
  paidDate: string;
  items: PoItemDraft[];
};

export type PoRevisionSummary = {
  revision: number;
  createdAt: string;
  itemCount: number;
  quoteNumber: string | null;
};

export type PoSearchResult = {
  poNumber: string;
  latestRevision: number;
  supplierName: string;
  poDate: string;
  itemCount: number;
  createdAt: string;
};
