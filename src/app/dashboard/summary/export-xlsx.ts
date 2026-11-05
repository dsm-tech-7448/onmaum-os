import type { SummaryRow } from "@/lib/dashboard/summary-sheet";

// Summary 표를 엑셀(.xlsx)로 내려받는다(2026-11-03). 화면에 지금 보이는 행(찾기·숨기기·과거 이력 표시
// 설정이 반영된 것)을 화면과 같은 열 순서로 내보낸다. 금액·수량은 엑셀에서 합계/정렬이 되도록 숫자로
// 넣고, 매출이익금은 화면과 같이 부가세 10%를 더한 값이다([[project_dashboard_vat_inclusive]]).
// 브라우저에서만 실행한다 — 파일 다운로드를 브라우저가 처리한다.
function toNumber(v: string | null | undefined): number | "" {
  if (v == null || v === "") return "";
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : "";
}

export async function downloadSummaryXlsx(rows: SummaryRow[], fileDate: string): Promise<void> {
  const XLSX = await import("xlsx");

  const header = [
    "날짜",
    "담당자",
    "기관명",
    "연락처",
    "상품코드",
    "상품명",
    "수량",
    "납기",
    "발송요청일",
    "고객 요청사항",
    "고객 입금(현금)",
    "고객 입금(카드)",
    "영수증(세금계산서)",
    "영수증(현금영수증)",
    "영수증(카드영수증)",
    "공급업체",
    "공급업체 연락처",
    "출고날짜(발송일)",
    "출금",
    "매출이익금",
    "매출이익률",
    "프로젝트 번호",
    "구분",
  ];

  const body = rows.map((r) => [
    r.orderDate,
    r.contactName,
    r.customerName,
    r.contactPhone,
    r.productCode,
    r.productName,
    toNumber(r.qty),
    r.reqDate,
    r.poReqDate,
    r.customerRequests,
    toNumber(r.paidCash),
    toNumber(r.paidCard),
    r.taxInvoiceIssuedAt,
    r.cashReceiptIssuedAt,
    r.cardReceiptIssuedAt,
    r.supplierName,
    r.supplierPhone,
    r.shipDate,
    toNumber(r.outAmount),
    r.profit == null ? "" : Math.round(r.profit * 1.1),
    r.marginRate == null ? "" : r.marginRate,
    r.projectNumber,
    r.isHistorical ? "과거 이력" : "",
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);

  // 열 너비 — 한글은 글자 폭이 넓어 헤더/내용 길이에 여유를 둔다.
  const widths = [12, 10, 20, 15, 10, 28, 8, 12, 12, 30, 14, 14, 16, 16, 16, 18, 15, 14, 12, 14, 10, 14, 10];
  sheet["!cols"] = widths.map((wch) => ({ wch }));

  // 숫자 서식: 수량/금액은 천 단위 콤마, 이익률은 퍼센트.
  const fmt: Record<number, string> = { 6: "#,##0", 10: "#,##0", 11: "#,##0", 18: "#,##0", 19: "#,##0", 20: "0.0%" };
  for (let r = 1; r <= body.length; r++) {
    for (const [c, z] of Object.entries(fmt)) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: Number(c) })];
      if (cell && cell.t === "n") cell.z = z;
    }
  }

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Summary");
  XLSX.writeFile(book, `Summary_${fileDate}.xlsx`);
}
