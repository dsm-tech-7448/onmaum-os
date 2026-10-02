// 세금계산서는 품목을 여러 줄로 보여주지 않고 한 줄(품명 하나)로 합쳐서만 다룬다
// (2026-09-22) — 거래명세서/견적서와 달리 단가·규격·단위·코드는 안 쓴다.
export type TaxInvoiceItemDraft = {
  uid: string;
  name: string;
  qty: string;
  supplyOverride: string; // 공급가액 (총)
  taxOverride: string; // 세액 (총) — 비우면 공급가액의 10%로 자동 계산
};

export type TaxInvoiceStatus = "requested" | "confirmed" | "issued";
export type TaxInvoicePurposeType = "청구" | "영수";

export type TaxInvoiceDraft = {
  invoiceNumber: string;
  statementId: string | null;
  customerName: string;
  // 영수/청구 — 이미 대금을 받았으면 "영수", 아직 안 받고 청구하는 거면 "청구"(기본값).
  purposeType: TaxInvoicePurposeType;
  // 사업자등록증 정보 — 거래명세서 발송 뒤에 늦게 받는 경우가 많아 선택 입력이다.
  // 등록번호/주소는 저장 시 연결된 거래명세서에도 함께 반영된다.
  customerBusinessNumber: string;
  // 종사업장번호 — 한 사업자등록번호 아래 사업장(지점)이 여러 개일 때만 있는 값, 대부분 비움.
  customerSubNum: string;
  customerCeoName: string;
  customerAddress: string;
  customerBusinessType: string;
  customerBusinessItem: string;
  // 입력해두면 발행(registIssue) 시 문서에 등록돼, 팝빌에서 문서 조회 시에도 이메일이
  // "확인"된다 — "이메일로 발송" 액션과는 별개(그건 발행 후 언제든 다른 주소로도 보내는 부가 기능).
  customerEmail: string;
  // 작성일자(세금계산서에 인쇄되는 공급시기 기준 날짜) — "발행 완료 처리"를 실제로
  // 누르는 날짜(발행일자)와 다를 수 있다. registIssue의 writeDate로 그대로 전달된다.
  scheduledDate: string;
  note: string;
  hometaxSent: boolean;
  items: TaxInvoiceItemDraft[];
  // 읽기 전용 — "이메일로 발송" 최근 성공 기록(저장 대상 아님, loadTaxInvoice가 채워줌).
  lastEmailSentTo?: string;
  lastEmailSentAt?: string;
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
