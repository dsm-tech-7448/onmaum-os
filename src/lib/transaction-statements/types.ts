import type { QuoteItemDraft } from "@/lib/quotes/types";

// statement_items는 po_items/quote_items와 구조가 같아 QuoteItemDraft를 그대로 재사용한다.
export type StatementItemDraft = QuoteItemDraft;

export type StatementDraft = {
  id?: string; // 저장된 거래명세서를 불러왔을 때만 존재 — 결제/영수증 기록 업데이트에 사용
  statementNumber: string;
  purchaseOrderId: string | null;
  quoteId: string | null;
  customerName: string;
  // 등록번호/담당자/주소는 견적서에 없는 값이라 필요할 때만 직접 입력한다.
  // (사업자등록증 사본을 나중에 받는 경우가 많아 처음엔 비워둘 수 있다)
  customerBusinessNumber: string;
  customerContactName: string;
  customerAddress: string;
  // 발주와 동시에 입금되는 경우도 있고 그렇지 않은 경우도 있어 선택 입력이다.
  // 아래 결제액(현금/카드) 입력이 새로 생겼지만 미수금은 계속 수기 입력 — 자동계산하지 않는다.
  outstandingAmount: string;
  // 실제 고객 결제 입력(참고용).
  paidCash: string;
  paidCard: string;
  paidDate: string;
  // 현금영수증 발행일 — 세금계산서와 별개, 둘 중 하나만 발행되면 다음 단계로 진행된다.
  cashReceiptIssuedAt: string;
  // 견적서와 마찬가지로 총액을 특정 금액에 맞추기 위한 절삭/조정 — 최종 합계에 그대로
  // 더해진다(음수 가능). 세금계산서는 법정 서식이라 이 개념이 없다.
  adjustmentLabel: string;
  adjustmentAmount: string;
  statementDate: string;
  note: string;
  items: StatementItemDraft[];
};

export type StatementSummary = {
  id: string;
  statementNumber: string;
  customerName: string;
  statementDate: string;
  itemCount: number;
  createdAt: string;
  quoteNumber: string | null;
};

export type ImportablePO = {
  poNumber: string;
  latestRevision: number;
  supplierName: string;
  itemCount: number;
  quoteId: string | null;
};

export type { QuoteSearchResult, QuoteReferenceSummary } from "@/lib/quotes/types";
