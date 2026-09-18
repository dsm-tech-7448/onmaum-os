// 팝빌 Node.js SDK("popbill" 패키지)는 타입 선언이 없는 순수 JS 패키지라 최소한의
// 앰비언트 타입만 직접 선언한다 — 실제 쓰는 함수/필드만 다룬다(SDK 전체를 다 타이핑하지
// 않음). 필드명/파라미터 순서는 팝빌 개발자 문서(developers.popbill.com) 기준.
declare module "popbill" {
  export interface PopbillError {
    code: number;
    message: string;
  }

  export interface PopbillConfig {
    LinkID: string;
    SecretKey: string;
    IsTest?: boolean;
    IPRestrictOnOff?: boolean;
    UseStaticIP?: boolean;
    UseLocalTimeYN?: boolean;
    defaultErrorHandler?: (error: PopbillError) => void;
  }

  export function config(options: PopbillConfig): void;

  // ── 전자세금계산서 ──────────────────────────────────────────────
  export interface TaxinvoiceDetail {
    serialNum: number;
    itemName?: string;
    qty?: string;
    unitCost?: string;
    supplyCost?: string;
    tax?: string;
    remark?: string;
    purchaseDT?: string;
  }

  export interface Taxinvoice {
    writeDate: string; // yyyyMMdd
    chargeDirection: "정과금" | "역과금";
    issueType: "정발행" | "역발행" | "위수탁";
    purposeType: "영수" | "청구" | "없음";
    taxType: "과세" | "영세" | "면세";

    invoicerMgtKey: string;
    invoicerCorpNum: string;
    invoicerCorpName: string;
    invoicerCEOName: string;
    invoicerTaxRegID?: string;
    invoicerAddr?: string;
    invoicerBizType?: string;
    invoicerBizClass?: string;
    invoicerContactName?: string;
    invoicerEmail?: string;
    invoicerHP?: string;

    invoiceeType: "사업자" | "개인" | "외국인";
    invoiceeCorpNum: string;
    invoiceeCorpName: string;
    invoiceeCEOName?: string;
    invoiceeTaxRegID?: string;
    invoiceeAddr?: string;
    invoiceeBizType?: string;
    invoiceeBizClass?: string;
    invoiceeContactName1?: string;
    invoiceeEmail1?: string;
    invoiceeHP1?: string;

    supplyCostTotal: string;
    taxTotal: string;
    totalAmount: string;

    detailList: TaxinvoiceDetail[];
  }

  export interface TaxinvoiceIssueResult {
    code: number;
    message: string;
    ntsResultCode?: string;
    ntsResultMessage?: string;
    ntsConfirmNum?: string;
  }

  export interface TaxinvoiceServiceInstance {
    registIssue(
      corpNum: string,
      taxinvoice: Taxinvoice,
      writeSpecification: boolean,
      forceIssue: boolean,
      memo: string,
      emailSubject: string,
      dealInvoiceMgtKey: string | null,
      userID: string | null,
      onSuccess: (result: TaxinvoiceIssueResult) => void,
      onError: (error: PopbillError) => void
    ): void;
  }

  export function TaxinvoiceService(): TaxinvoiceServiceInstance;

  // ── 카카오톡(알림톡) ────────────────────────────────────────────
  export interface KakaoButton {
    n?: string; // 버튼명
    t?: string; // 버튼유형 (WL: 웹링크 등)
    u1?: string; // 모바일 URL
    u2?: string; // PC URL
  }

  export interface KakaoServiceInstance {
    sendATS_one(
      corpNum: string,
      templateCode: string,
      sender: string,
      content: string,
      altSubject: string,
      altContent: string,
      altSendType: "A" | "C" | "",
      sndDT: string | null,
      receiver: string,
      receiverName: string,
      requestNum: string | null,
      btns: KakaoButton[] | null,
      emphasizeTitle: string | null,
      userID: string | null,
      onSuccess: (receiptNum: string) => void,
      onError: (error: PopbillError) => void
    ): void;
  }

  export function KakaoService(): KakaoServiceInstance;
}
