import type { QuoteDraft } from "./types";

export function blankDraft(quoteNumber: string): QuoteDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    quoteNumber,
    mode: "single",
    customerName: "",
    contactName: "",
    contactPhone: "",
    quoteDate: today,
    validity: "견적 후 7일",
    confirmText:
      "・출고일 : 발주 후 5일\n・결제조건 : 세금계산서 발행 후 7일 이내\n・상기 견적은 부가세(VAT) 포함 금액입니다.",
    mainImageDataUrl: null,
    compareProductCode: "",
    compareProductName: "",
    compareProductSpec: "",
    adjustmentLabel: "절삭",
    adjustmentAmount: "",
    items: [],
    tiers: [],
  };
}
