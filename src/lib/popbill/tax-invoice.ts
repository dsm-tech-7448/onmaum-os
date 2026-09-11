import { eq } from "drizzle-orm";
import { db } from "@/db";
import { taxInvoices, taxInvoiceItems, companyProfile } from "@/db/schema";
import { getTaxinvoiceService, isPopbillConfigured, POPBILL_CORP_NUM } from "./client";

export type PopbillIssueResult =
  | { ok: true; ntsConfirmNum?: string }
  | { ok: false; error: string };

function toYyyyMmDd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// 견적서/명세서와 같은 계산 규칙(summary-sheet.ts와 동일): 수기 공급가(supplyOverride)가
// 있으면 그 값을, 없으면 수량×단가를 그 줄의 공급가로 쓴다. 부가세는 공급가의 10%.
function lineSupply(qty: string | null, price: string | null, supplyOverride: string | null): number {
  if (supplyOverride != null && supplyOverride !== "") return Number(supplyOverride);
  return Number(qty ?? 0) * Number(price ?? 0);
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

  const detailList = items.map((it, idx) => {
    const supply = lineSupply(it.qty, it.price, it.supplyOverride);
    const tax = Math.round(supply * 0.1);
    return {
      serialNum: idx + 1,
      itemName: it.name,
      qty: it.qty ?? undefined,
      unitCost: it.price ?? undefined,
      supplyCost: String(Math.round(supply)),
      tax: String(tax),
    };
  });
  const supplyCostTotal = detailList.reduce((sum, d) => sum + Number(d.supplyCost), 0);
  const taxTotal = detailList.reduce((sum, d) => sum + Number(d.tax), 0);

  const service = getTaxinvoiceService();

  return new Promise<PopbillIssueResult>((resolve) => {
    service.registIssue(
      POPBILL_CORP_NUM,
      {
        writeDate: toYyyyMmDd(new Date()),
        chargeDirection: "정과금",
        issueType: "정발행",
        purposeType: "청구", // 대금 청구 목적 — 계약 조건에 따라 "영수"로 바꿔야 할 수 있음(사용자 확인 필요)
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
        invoiceeCorpName: invoice.customerName,
        invoiceeCEOName: invoice.customerCeoName ?? undefined,
        invoiceeAddr: invoice.customerAddress ?? undefined,
        invoiceeBizType: invoice.customerBusinessType ?? undefined,
        invoiceeBizClass: invoice.customerBusinessItem ?? undefined,

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
