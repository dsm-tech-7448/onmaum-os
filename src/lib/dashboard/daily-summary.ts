import { db } from "@/db";
import { dailySummaryEntries } from "@/db/schema";
import { getSummaryRows } from "./summary-sheet";

// "Daily Summary" 화면(/dashboard/daily-summary) 전용 — 원본 Daily Summary 엑셀
// (D:\0. 회사\0. Daily Summary- 0323(New).xlsx)의 컬럼을 한 칸도 빠짐없이 그대로 보여준다.
// /dashboard/summary(quote_item 기준, 컬럼 축소판, 정정값은 원본 위에 덮어쓰는 방식)와는
// 완전히 별개 화면이다 — 여기서는 daily_summary_entries(엑셀 이관 + 직접 입력)를 직접
// 편집하고, ONMAUM-OS 라이브 데이터는 참고용으로 연동해서 같이 보여주되 읽기 전용이다
// (라이브 데이터 수정은 /dashboard/summary나 각 프로젝트 화면에서).
export type DailySummaryRow = {
  rowKey: string;
  source: "live" | "excel" | "manual";
  entryId: string | null; // daily_summary_entries.id — excel/manual 행만 편집 가능
  projectId: string | null; // live 행이면 프로젝트 링크용
  division: string; // 구분
  orderDate: string; // 날짜
  contactName: string; // 이름
  customerName: string; // 기관명
  contactOffice: string; // 연락처-Office
  contactMobile: string; // 연락처-Mobile
  productCode: string; // 제품코드
  productName: string; // 제품명
  qty: string; // 필요수량
  reqDate: string; // 요청날짜
  supplierName: string; // 공급업체
  supplierPhone: string; // 전화번호(공급업체)
  shipDate: string; // 출고날짜
  note: string; // 특기사항
  paidCash: number | null; // 결제-현금
  paidCard: number | null; // 결제-카드
  outAmount: number | null; // 출금
  cashReceiptDate: string; // 영수증-현금영수증
  taxInvoiceDate: string; // 영수증-세금계산서
  profit: number | null; // 매출이익 = (결제현금+결제카드) - 출금 — 원본 엑셀 수식과 동일(실입금-실출금 기준)
  marginRate: number | null; // 마진율 = 매출이익 / 출금 — 원본 엑셀 수식과 동일(원가 대비, 매출 대비 아님)
};

function computeProfit(paidCash: number | null, paidCard: number | null, outAmount: number | null): number | null {
  if (paidCash == null && paidCard == null && outAmount == null) return null;
  return (paidCash ?? 0) + (paidCard ?? 0) - (outAmount ?? 0);
}

function computeMarginRate(profit: number | null, outAmount: number | null): number | null {
  if (profit == null || !outAmount) return null;
  return profit / outAmount;
}

export async function getDailySummaryRows(): Promise<DailySummaryRow[]> {
  const [liveRows, entryRows] = await Promise.all([
    getSummaryRows({ includeHistorical: false }),
    db.select().from(dailySummaryEntries),
  ]);

  const live: DailySummaryRow[] = liveRows.map((r) => {
    const paidCash = r.paidCash ? Number(r.paidCash) : null;
    const paidCard = r.paidCard ? Number(r.paidCard) : null;
    const outAmount = r.outAmount ? Number(r.outAmount) : null;
    const profit = computeProfit(paidCash, paidCard, outAmount);
    return {
      rowKey: `live-${r.rowKey}`,
      source: "live",
      entryId: null,
      projectId: r.projectId || null,
      division: "온마음기프트",
      orderDate: r.orderDate,
      contactName: r.contactName,
      customerName: r.customerName,
      contactOffice: "",
      contactMobile: r.contactPhone,
      productCode: r.productCode,
      productName: r.productName,
      qty: r.qty,
      reqDate: r.reqDate,
      supplierName: r.supplierName,
      supplierPhone: r.supplierPhone,
      shipDate: r.shipDate,
      note: "",
      paidCash,
      paidCard,
      outAmount,
      cashReceiptDate: r.cashReceiptIssuedAt,
      taxInvoiceDate: r.taxInvoiceIssuedAt,
      profit,
      marginRate: computeMarginRate(profit, outAmount),
    };
  });

  const entries: DailySummaryRow[] = entryRows.map((e) => {
    const paidCash = e.paidCash != null ? Number(e.paidCash) : null;
    const paidCard = e.paidCard != null ? Number(e.paidCard) : null;
    const outAmount = e.outAmount != null ? Number(e.outAmount) : null;
    const profit = computeProfit(paidCash, paidCard, outAmount);
    return {
      rowKey: `entry-${e.id}`,
      source: e.source === "manual" ? "manual" : "excel",
      entryId: e.id,
      projectId: null,
      division: e.division ?? "",
      orderDate: e.orderDate ?? "",
      contactName: e.contactName ?? "",
      customerName: e.customerName ?? "",
      contactOffice: e.contactOffice ?? "",
      contactMobile: e.contactMobile ?? "",
      productCode: e.productCode ?? "",
      productName: e.productName ?? "",
      qty: e.qty ?? "",
      reqDate: e.reqDate ?? "",
      supplierName: e.supplierName ?? "",
      supplierPhone: e.supplierPhone ?? "",
      shipDate: e.shipDate ?? "",
      note: e.note ?? "",
      paidCash,
      paidCard,
      outAmount,
      cashReceiptDate: e.cashReceiptDate ?? "",
      taxInvoiceDate: e.taxInvoiceDate ?? "",
      profit,
      marginRate: computeMarginRate(profit, outAmount),
    };
  });

  return [...live, ...entries].sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""));
}
