import * as XLSX from "xlsx";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { dailySummaryEntries, type NewDailySummaryEntry } from "../src/db/schema";

// "Daily Summary" 화면(/dashboard/daily-summary) 전용 재업로드 스크립트 — 원본 엑셀
// (D:\0. 회사\0. Daily Summary- 0323(New).xlsx)의 컬럼을 전부, 순서 그대로 daily_summary_entries에
// 옮긴다. historical_orders(/dashboard/summary용, 컬럼 축소판)와는 완전히 별개 테이블이라
// 이 스크립트를 몇 번을 다시 돌려도 그쪽에는 영향이 없다.
//
// 브랜드 범위는 기존 historical_orders 이관 때와 같은 원칙(2026-09-03 사용자 확인) —
// 온마음기프트(+미기재)만. 이루미기프트는 제외(이 앱은 온마음기프트 단일 사업체 기준).
//
// 재실행 시 idempotent: source='excel' 행만 전부 지우고 다시 채운다 — source='manual'
// (화면에서 직접 입력한 행)은 절대 건드리지 않는다.

const FILE_PATH = path.join("D:\\", "0. \ud68c\uc0ac", "0. Daily Summary- 0323(New).xlsx");
const ALLOWED_BRANDS = new Set(["온마음기프트", ""]);

function excelDateToIso(v: unknown): string | null {
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d || !d.y) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";
  return s || null;
}

function rowsFromExcel(): NewDailySummaryEntry[] {
  const wb = XLSX.readFile(FILE_PATH);
  const sheet = wb.Sheets["Sheet1"];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];

  // 헤더 2줄(0,1) 다음부터가 데이터. 컬럼 순서(0-based):
  // 0=구분 1=날짜 2=이름 3=기관명 4=연락처Office 5=연락처Mobile 6=제품코드 7=제품명
  // 8=필요수량 9=요청날짜 10=공급업체 11=전화번호 12=출고날짜 13=특기사항
  // 14=결제현금 15=결제카드 16=출금 17=영수증현금영수증 18=영수증세금계산서
  // (19=매출이익, 20=마진율은 엑셀 수식이라 그대로 가져오지 않고 화면에서 다시 계산한다)
  const out: NewDailySummaryEntry[] = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const orderDate = excelDateToIso(r[1]);
    if (!orderDate) continue; // 날짜 없는 행은 빈 줄/합계 줄 등 실데이터가 아님
    const brand = str(r[0]) ?? "";
    if (!ALLOWED_BRANDS.has(brand)) continue;

    out.push({
      source: "excel",
      division: str(r[0]) ?? "온마음기프트",
      orderDate,
      contactName: str(r[2]),
      customerName: str(r[3]),
      contactOffice: str(r[4]),
      contactMobile: str(r[5]),
      productCode: str(r[6]),
      productName: str(r[7]),
      qty: num(r[8]) != null ? String(num(r[8])) : null,
      reqDate: excelDateToIso(r[9]),
      supplierName: str(r[10]),
      supplierPhone: str(r[11]),
      shipDate: excelDateToIso(r[12]),
      note: str(r[13]),
      paidCash: num(r[14]) != null ? String(num(r[14])) : null,
      paidCard: num(r[15]) != null ? String(num(r[15])) : null,
      outAmount: num(r[16]) != null ? String(num(r[16])) : null,
      cashReceiptDate: excelDateToIso(r[17]),
      taxInvoiceDate: excelDateToIso(r[18]),
      sourceFile: "0323(New)",
    });
  }
  return out;
}

async function main() {
  const rows = rowsFromExcel();
  console.log(`이관 대상 ${rows.length}건 (온마음기프트+미기재만, 이루미기프트 제외)`);

  await db.delete(dailySummaryEntries).where(eq(dailySummaryEntries.source, "excel"));
  console.log("기존 source='excel' 행 삭제 완료 (source='manual' 행은 유지)");

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await db.insert(dailySummaryEntries).values(batch);
    inserted += batch.length;
    console.log(`  ${inserted}/${rows.length} 저장됨`);
  }

  console.log("완료");
  process.exit(0);
}

main().catch((error) => {
  console.error("daily_summary_entries 이관 실패:", error);
  process.exit(1);
});
