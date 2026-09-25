import { eq } from "drizzle-orm";
import { db } from "@/db";
import { taxInvoices, taxInvoiceItems, companyProfile } from "@/db/schema";
import { getTaxinvoiceService, isPopbillConfigured, POPBILL_CORP_NUM } from "./client";
import { mergeToSingleItem } from "@/lib/tax-invoices/merge-items";

export type PopbillIssueResult =
  | { ok: true; ntsConfirmNum?: string }
  | { ok: false; error: string };

function toYyyyMmDd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// 세금계산서 1건을 팝빌로 실제 발행(정발행)한다. 팝빌 계정이 설정되지 않았으면(계정 가입/
// 사업자 인증/알림톡과 별개로 세금계산서는 팝빌 가입만 되어 있으면 됨) 호출하지 않고
// "설정 안 됨"으로 반환한다 — issueTaxInvoice 액션은 이 결과와 무관하게 내부 상태(issued)는
// 항상 먼저 기록하고, 팝빌 발행은 성공하면 국세청 접수까지 완료된 것으로 보는 부가 단계다.
export async function issueTaxInvoiceViaPopbill(taxInvoiceId: string): Promise<PopbillIssueResult> {
  if (!isPopbillConfigured()) {
    return { ok: false, error: "팝빌 연동 설정(POPBILL_LINK_ID/SECRET_KEY/CORP_NUM)이 안 되어 있습니다." };
  }

  const [invoice] = await db.select().from(taxInvoices).where(eq(taxInvoices.id, taxInvoiceId)).limit(1);
  if (!invoice) return { ok: false, error: "세금계산서를 찾을 수 없습니다." };
  if (!invoice.customerBusinessNumber?.trim()) {
    return { ok: false, error: "공급받는자 사업자등록번호가 없어 팝빌 발행을 할 수 없습니다." };
  }

  const [company] = await db.select().from(companyProfile).limit(1);
  if (!company) return { ok: false, error: "자사 기준정보(company_profile)가 없어 발행자 정보를 알 수 없습니다." };

  const items = await db
    .select()
    .from(taxInvoiceItems)
    .where(eq(taxInvoiceItems.taxInvoiceId, taxInvoiceId))
    .orderBy(taxInvoiceItems.sortOrder);
  if (items.length === 0) return { ok: false, error: "품목이 없어 발행할 수 없습니다." };

  // 실제로 발행되는 세금계산서에는 항목이 몇 줄 저장돼 있든 품명 하나로 합쳐서 한 줄만
  // 보낸다(2026-09-22) — 단가 없이 공급가액·세액 총액만 쓴다.
  const merged = mergeToSingleItem(items);
  const supplyCostTotal = Math.round(merged.supply);
  const taxTotal = Math.round(merged.tax);
  const detailList = [
    {
      serialNum: 1,
      itemName: merged.name,
      qty: merged.qty || undefined,
      supplyCost: String(supplyCostTotal),
      tax: String(taxTotal),
    },
  ];

  const service = getTaxinvoiceService();

  // 작성일자(세금계산서에 인쇄되는 공급시기 기준 날짜)는 "발행 완료 처리"를 누르는
  // 오늘 날짜와 다를 수 있다 — draft에 입력된 값(scheduledDate)을 그대로 쓰고, 비어
  // 있으면 지금까지 해오던 대로 오늘 날짜로 채운다(2026-09-25, 이전에는 항상 오늘
  // 날짜로 하드코딩돼 있어 월말 납품·다음 달 초 발행 같은 경우를 반영할 수 없었다).
  const writeDate = invoice.scheduledDate ? invoice.scheduledDate.replace(/-/g, "") : toYyyyMmDd(new Date());

  return new Promise<PopbillIssueResult>((resolve) => {
    service.registIssue(
      POPBILL_CORP_NUM,
      {
        writeDate,
        chargeDirection: "정과금",
        issueType: "정발행",
        purposeType: invoice.purposeType === "영수" ? "영수" : "청구", // 세금계산서 발행 화면에서 선택(2026-09-22)
        taxType: "과세",

        invoicerMgtKey: invoice.invoiceNumber,
        invoicerCorpNum: POPBILL_CORP_NUM,
        invoicerCorpName: company.companyName,
        invoicerCEOName: company.ceoName,
        invoicerAddr: company.businessPlaceAddress ?? undefined,
        invoicerBizType: company.businessType ?? undefined,
        invoicerBizClass: company.businessItem ?? undefined,
        invoicerContactName: company.ceoName,
        invoicerEmail: company.email ?? undefined,
        invoicerHP: company.phone ?? undefined,

        invoiceeType: "사업자",
        invoiceeCorpNum: invoice.customerBusinessNumber!.replace(/-/g, ""),
        invoiceeTaxRegID: invoice.customerSubNum || undefined, // 종사업장번호(있는 경우만, 2026-09-22)
        invoiceeCorpName: invoice.customerName,
        invoiceeCEOName: invoice.customerCeoName ?? undefined,
        invoiceeAddr: invoice.customerAddress ?? undefined,
        invoiceeBizType: invoice.customerBusinessType ?? undefined,
        invoiceeBizClass: invoice.customerBusinessItem ?? undefined,
        // 입력해두면 문서 자체에 이메일이 등록돼 팝빌에서 문서 조회 시에도 "확인"된다
        // (2026-09-22) — 이게 없으면 "이메일로 발송"을 실제로 성공시켜도 발송 이력에만
        // 남고 문서 정보(공급받는자 이메일)엔 안 남아 확인이 안 되는 것처럼 보인다.
        invoiceeEmail1: invoice.customerEmail || undefined,

        supplyCostTotal: String(supplyCostTotal),
        taxTotal: String(taxTotal),
        totalAmount: String(supplyCostTotal + taxTotal),

        detailList,
      },
      false,
      true,
      "",
      "",
      null,
      null,
      (result) => resolve({ ok: true, ntsConfirmNum: result.ntsConfirmNum }),
      (error) => resolve({ ok: false, error: `[${error.code}] ${error.message}` })
    );
  });
}

// 이미 발행된 세금계산서를 원하는 이메일로 (재)발송한다(2026-09-22) — registIssue와
// 무관하게 발행 완료 뒤 언제든 호출할 수 있다. invoicerMgtKey로 쓴 값(=견적번호 형식이
// 아니라 세금계산서 번호 자체)을 MgtKey로 그대로 넘긴다.
export async function sendTaxInvoiceEmailViaPopbill(
  invoiceNumber: string,
  email: string
): Promise<PopbillIssueResult> {
  if (!isPopbillConfigured()) {
    return { ok: false, error: "팝빌 연동 설정(POPBILL_LINK_ID/SECRET_KEY/CORP_NUM)이 안 되어 있습니다." };
  }

  const service = getTaxinvoiceService();

  return new Promise<PopbillIssueResult>((resolve) => {
    service.sendEmail(
      POPBILL_CORP_NUM,
      "SELL",
      invoiceNumber,
      email,
      () => resolve({ ok: true }),
      (error) => resolve({ ok: false, error: `[${error.code}] ${error.message}` })
    );
  });
}
