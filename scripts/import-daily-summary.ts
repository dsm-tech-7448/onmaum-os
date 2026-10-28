import * as XLSX from "xlsx";
import path from "path";
import { db } from "../src/db";
import { historicalOrders, type NewHistoricalOrder } from "../src/db/schema";

// 과거 Daily Summary 엑셀 2개를 하나로 합쳐서 historical_orders에 이관한다.
// - 0715.xlsx: 2017-11~2026-03 전체 이력(스냅샷). 2026-01 이후 구간은 0323(New).xlsx가
//   더 최신/완전하므로 0715 쪽은 2026년 이전 데이터만 쓴다.
// - 0323(New).xlsx: 2026-01~2026-08, 가장 최근까지 갱신된 파일이라 2026년 데이터는 전부 여기서.
// 브랜드는 온마음/온마음기프트/온마음마켓 계열만(사용자 확인, 2026-09-03) — 이루미/모드니에/외부 제외.
// 구분(브랜드)이 비어있는 행은 대부분 2020년 이전(멀티 브랜드화 이전) 행이라 온마음으로 간주.

const ONMAUM_BRANDS = new Set(["온마음", "온마음기프트", "온마음마켓", ""]);

function excelDateToIso(v: unknown): string | null {
  if (typeof v !== "number") return null;
  const d = XLSX.SSF.parse_date_code(v);
  if (!d || !d.y) return null;
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";
}

function pickPhone(office: unknown, mobile: unknown): string {
  return str(mobile) || str(office);
}

function rowsFrom0715(): NewHistoricalOrder[] {
  const filePath = path.join("D:\\", "0. \ud68c\uc0ac", "0. Daily Summary- 0715.xlsx");
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Daily Summary"], { header: 1, defval: "" }) as unknown[][];

  const out: NewHistoricalOrder[] = [];
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i];
    const brand = str(r[0]);
    const orderDate = excelDateToIso(r[2]);
    if (!orderDate) continue; // 날짜 없는 행은 실데이터가 아님(빈 줄/합계 줄 등)
    if (orderDate >= "2026-01-01") continue; // 2026년 이후는 0323(New)이 더 최신이라 제외
    if (!ONMAUM_BRANDS.has(brand)) continue;

    const revenue = num(r[17]) + num(r[18]);
    const cost = num(r[19]);
    out.push({
      brand: brand || "온마음",
      orderDate,
      customerName: str(r[4]) || null,
      contactName: str(r[3]) || null,
      contactPhone: pickPhone(r[5], r[6]) || null,
      productName: str(r[8]) || null,
      qty: r[9] ? String(num(r[9])) : null,
      supplierName: str(r[11]) || null,
      supplierPhone: str(r[12]) || null,
      shipDate: excelDateToIso(r[13]),
      note: str(r[16]) || null,
      revenue: revenue ? String(revenue) : null,
      cost: cost ? String(cost) : null,
      profit: revenue || cost ? String(revenue - cost) : null,
      sourceFile: "0715",
    });
  }
  return out;
}

function rowsFrom0323(): NewHistoricalOrder[] {
  const filePath = path.join("D:\\", "0. \ud68c\uc0ac", "0. Daily Summary- 0323(New).xlsx");
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Sheet1"], { header: 1, defval: "" }) as unknown[][];

  const out: NewHistoricalOrder[] = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const brand = str(r[0]);
    const orderDate = excelDateToIso(r[1]);
    if (!orderDate) continue;
    // 0323 파일은 온마음기프트/이루미기프트가 섞여 있음 — 온마음기프트(+미기재)만.
    if (brand !== "온마음기프트" && brand !== "") continue;

    const revenue = num(r[14]) + num(r[15]);
    const cost = num(r[16]);
    out.push({
      brand: brand || "온마음기프트",
      orderDate,
      customerName: str(r[3]) || null,
      contactName: str(r[2]) || null,
      contactPhone: pickPhone(r[4], r[5]) || null,
      productName: str(r[7]) || null,
      qty: r[8] ? String(num(r[8])) : null,
      supplierName: str(r[10]) || null,
      supplierPhone: str(r[11]) || null,
      shipDate: excelDateToIso(r[12]),
      note: str(r[13]) || null,
      revenue: revenue ? String(revenue) : null,
      cost: cost ? String(cost) : null,
      profit: revenue || cost ? String(revenue - cost) : null,
      sourceFile: "0323(New)",
    });
  }
  return out;
}

async function main() {
  const rows = [...rowsFrom0715(), ...rowsFrom0323()];
  console.log(`이관 대상 ${rows.length}건 (0715: ${rows.filter((r) => r.sourceFile === "0715").length}, 0323: ${rows.filter((r) => r.sourceFile === "0323(New)").length})`);

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await db.insert(historicalOrders).values(batch);
    inserted += batch.length;
    console.log(`  ${inserted}/${rows.length} 저장됨`);
  }

  console.log("완료");
  process.exit(0);
}

main().catch((error) => {
  console.error("historical_orders 이관 실패:", error);
  process.exit(1);
});
