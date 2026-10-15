// 세금계산서에 각 품목이 줄줄이 나오는 게 보기 안 좋다는 요청(2026-09-22)으로, 거래명세서
// 품목이 몇 줄이든 세금계산서에는 품목 하나(품명/수량/공급가액 총/세액 총)만 보여주기로
// 했다. 단가는 더 이상 안 쓴다 — 공급가액은 항상 총액(줄마다 수기 입력값이 있으면 그 값,
// 없으면 qty×price)의 합이고, 세액은 줄마다 수기 입력된 세액(taxOverride)이 하나라도 있으면
// 그 합, 하나도 없으면 공급가액의 10%로 자동 계산한다.
//
// 거래명세서에서 막 가져온 줄(statement_items, price 있음)과 예전에 저장된 세금계산서
// 줄(tax_invoice_items, taxOverride 있음)을 같은 함수로 다룰 수 있게 필드를 모두 선택적으로 받는다.
export type MergeableRow = {
  name: string;
  qty?: string | number | null;
  price?: string | number | null;
  supplyOverride?: string | number | null;
  taxOverride?: string | number | null;
};

export type MergedTaxInvoiceItem = {
  name: string;
  qty: string;
  supply: number;
  tax: number;
};

function n(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const num = Number(v);
  return Number.isFinite(num) ? num : 0;
}

export function mergeToSingleItem(rows: MergeableRow[]): MergedTaxInvoiceItem {
  if (rows.length === 0) return { name: "", qty: "", supply: 0, tax: 0 };

  const names = rows.map((r) => r.name?.trim()).filter((v): v is string => !!v);
  const name = names.length <= 1 ? (names[0] ?? "") : `${names[0]} 외 ${names.length - 1}건`;

  let supply = 0;
  let taxSum = 0;
  let hasTaxOverride = false;
  for (const r of rows) {
    const amt = r.supplyOverride != null && r.supplyOverride !== "" ? n(r.supplyOverride) : n(r.qty) * n(r.price);
    supply += amt;
    if (r.taxOverride != null && r.taxOverride !== "") {
      taxSum += n(r.taxOverride);
      hasTaxOverride = true;
    }
  }
  const tax = hasTaxOverride ? taxSum : Math.round(supply * 0.1);

  // 수량: 합치는 줄들이 전부 같은 수량이면 그 값을 그대로, 단위가 다른 품목을 억지로
  // 더하면 의미가 왜곡되니 하나라도 다르면 비워서 사용자가 직접 입력하게 한다.
  const qtys = rows.map((r) => (r.qty != null ? String(r.qty) : "")).filter((q) => q !== "");
  const qty = qtys.length > 0 && qtys.every((q) => q === qtys[0]) ? qtys[0] : "";

  return { name, qty, supply, tax };
}
