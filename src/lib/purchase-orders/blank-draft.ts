import type { PoDraft } from "./types";

export function blankPoDraft(poNumber: string): PoDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    poNumber,
    quoteId: null,
    quoteItemId: null,
    supplierId: null,
    supplierName: "",
    supplierPhone: "",
    receiver: "",
    poDate: today,
    reqDate: "",
    payTerm: "현금",
    printNote: "없음",
    shipAddr: "",
    shipReceiver: "",
    note: "",
    requestNote: "- 발송자를 온마음기프트로 기재 요망\n- 송장번호 통보요망",
    paidAmount: "",
    paidDate: "",
    items: [],
  };
}
