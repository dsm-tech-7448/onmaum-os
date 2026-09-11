export type QuoteMode = "single" | "multiple" | "compare";
export type QuoteLineType = "product" | "option";

export type QuoteItemDraft = {
  uid: string; // client-only temp id for React keys / reordering, not persisted
  lineType: QuoteLineType;
  code: string;
  name: string;
  spec: string;
  unit: string;
  qty: string;
  price: string;
  imageDataUrl?: string | null; // 품목(product) 줄 전용 이미지 — 견적서에서만 사용
  // 단가로 나누어떨어지지 않는 공급가를 그대로 수기 입력할 때 쓴다 — 값이 있으면
  // 수량×단가 대신 이 값을 그 줄의 공급가로 쓴다. 거래명세서/세금계산서로 그대로 이어진다.
  supplyOverride?: string;
  // 원본 견적 품목 id — 거래명세서 품목에서만 의미 있다(견적/발주서 품목은 항상 비어있음).
  // 대시보드 원장이 발주(매입)와 거래명세서 품목(매출)을 이름 대조 없이 매칭하는 데 쓴다.
  quoteItemId?: string | null;
};

export type QuoteTierDraft = {
  uid: string;
  items: QuoteItemDraft[];
};

export type QuoteDraft = {
  quoteNumber: string;
  mode: QuoteMode;
  customerName: string;
  // 고객사 담당자는 자주 바뀌고 한 회사에 여러 명일 수 있어 고객사 마스터에서 끌어오지 않고
  // 견적 작성 시점마다 직접 입력한다.
  contactName: string;
  contactPhone: string;
  quoteDate: string;
  validity: string;
  confirmText: string;
  mainImageDataUrl: string | null;
  compareProductCode: string;
  compareProductName: string;
  compareProductSpec: string;
  // 견적 총액을 특정 금액(예: 육백만원 정)에 맞추기 위한 절삭/조정 — 품목별 계산과
  // 별개로 최종 합계에 그대로 더해진다(음수 가능).
  adjustmentLabel: string;
  adjustmentAmount: string;
  items: QuoteItemDraft[];
  tiers: QuoteTierDraft[];
};

export type QuoteRevisionSummary = {
  revision: number;
  createdAt: string;
  itemCount: number;
  productName: string;
};

export type QuoteSearchResult = {
  quoteNumber: string;
  latestRevision: number;
  customerName: string;
  quoteDate: string;
  itemCount: number;
  createdAt: string;
  productName: string;
};

// "불러오기"로 명시적으로 선택한 견적서의 요약 — 시안/발주서 작성 화면에 참고용으로
// 보여주고, 저장 시 그 견적(quoteId)에 연결한다. drafts/purchase-orders가 함께 쓴다.
export type QuoteReferenceSummary = {
  id: string;
  quoteNumber: string;
  revision: number;
  customerName: string;
  contactName: string;
  contactPhone: string;
  quoteDate: string;
  mode: string;
  compareProductName: string;
  mainImageDataUrl: string | null;
  items: {
    id: string;
    lineType: string;
    name: string;
    spec: string;
    unit: string;
    qty: string;
    price: string;
    imageDataUrl: string | null;
    supplyOverride?: string;
  }[];
  supply: number;
  vat: number;
  total: number;
};
