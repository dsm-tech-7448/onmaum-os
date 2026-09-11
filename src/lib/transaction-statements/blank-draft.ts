import type { StatementDraft } from "./types";

export function blankStatementDraft(statementNumber: string): StatementDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    statementNumber,
    purchaseOrderId: null,
    quoteId: null,
    customerName: "",
    customerBusinessNumber: "",
    customerContactName: "",
    customerAddress: "",
    outstandingAmount: "",
    paidCash: "",
    paidCard: "",
    paidDate: "",
    cashReceiptIssuedAt: "",
    adjustmentLabel: "절삭",
    adjustmentAmount: "",
    statementDate: today,
    note: "・본 거래명세서는 부가세(VAT) 포함 금액입니다.",
    items: [],
  };
}
