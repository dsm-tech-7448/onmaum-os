import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "../src/db";
import { customers, suppliers, type NewCustomer, type NewSupplier } from "../src/db/schema";

// 루트(ONMAUM-OS)에 있는 원본 시드 엑셀. 프로젝트 폴더(onmaum-os-web) 기준 한 단계 위.
const SEED_XLSX_PATH = resolve(
  __dirname,
  "../../온마음OS_고객공급업체_시드데이터.xlsx"
);

const CUSTOMER_SHEET = "고객 시드데이터";
const SUPPLIER_SHEET = "공급업체 시드데이터";
const DATA_START_ROW = 3; // 0: 제목, 1: 빈 행, 2: 헤더, 3~: 데이터
const BATCH_SIZE = 250;
const DORMANT_THRESHOLD_DAYS = 365;

function nullIfEmpty(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
}

function toInt(value: unknown): number {
  const s = String(value ?? "").trim();
  if (s === "") return 0;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}

function toNullableInt(value: unknown): number | null {
  const s = String(value ?? "").trim();
  if (s === "") return null;
  const n = Number.parseFloat(s);
  return Number.isNaN(n) ? null : Math.round(n);
}

function toNullableNumeric(value: unknown): string | null {
  const s = String(value ?? "").trim().replace(/,/g, "");
  if (s === "") return null;
  const n = Number.parseFloat(s);
  return Number.isNaN(n) ? null : n.toFixed(2);
}

function toNullableDate(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// 온마음OS_기준정보_목록_고객등급체계.md "등급 산정 로직 (시스템 구현 시)"
function computeGrade(transactionCount: number): string {
  if (transactionCount >= 14) return "VIP";
  if (transactionCount >= 6) return "우수";
  if (transactionCount >= 2) return "재구매";
  return "일반";
}

function computeIsDormant(lastTransactionDate: string | null): boolean {
  if (!lastTransactionDate) return false;
  const last = new Date(lastTransactionDate);
  const diffDays = (Date.now() - last.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= DORMANT_THRESHOLD_DAYS;
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => String(cell ?? "").trim() === "");
}

function chunk<T>(rows: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    chunks.push(rows.slice(i, i + BATCH_SIZE));
  }
  return chunks;
}

async function seedCustomers(workbook: XLSX.WorkBook) {
  const [{ count }] = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from customers`
  );
  if (Number(count) > 0) {
    console.log(`customers already has ${count} rows — skipping import.`);
    return;
  }

  const sheet = workbook.Sheets[CUSTOMER_SHEET];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  const records: NewCustomer[] = rows
    .slice(DATA_START_ROW)
    .filter((row) => !isBlankRow(row))
    .map((row) => {
      const transactionCount = toInt(row[8]);
      const lastTransactionDate = toNullableDate(row[11]);

      return {
        companyName: String(row[0] ?? "").trim(),
        businessNumber: nullIfEmpty(row[1]),
        contactName: nullIfEmpty(row[2]),
        mobilePhone: nullIfEmpty(row[3]),
        officePhone: nullIfEmpty(row[4]),
        email: nullIfEmpty(row[5]),
        address: nullIfEmpty(row[6]),
        acquisitionChannel: nullIfEmpty(row[7]),
        transactionCount,
        totalAmount: toNullableNumeric(row[9]),
        firstTransactionDate: toNullableDate(row[10]),
        lastTransactionDate,
        peakSeasonMonth: toNullableInt(row[12]),
        customerGrade: computeGrade(transactionCount),
        isDormant: computeIsDormant(lastTransactionDate),
        notes: nullIfEmpty(row[15]),
      };
    });

  console.log(`customers: importing ${records.length} rows...`);
  for (const batch of chunk(records)) {
    await db.insert(customers).values(batch);
    console.log(`  inserted batch of ${batch.length}`);
  }
  console.log(`customers: done (${records.length} rows).`);
}

async function seedSuppliers(workbook: XLSX.WorkBook) {
  const [{ count }] = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from suppliers`
  );
  if (Number(count) > 0) {
    console.log(`suppliers already has ${count} rows — skipping import.`);
    return;
  }

  const sheet = workbook.Sheets[SUPPLIER_SHEET];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  const records: NewSupplier[] = rows
    .slice(DATA_START_ROW)
    .filter((row) => !isBlankRow(row))
    .map((row) => ({
      companyName: String(row[0] ?? "").trim(),
      contactName: nullIfEmpty(row[1]),
      phone: nullIfEmpty(row[2]),
      email: nullIfEmpty(row[3]),
      productCategory: nullIfEmpty(row[4]),
      transactionCount: toInt(row[5]),
      totalPurchaseAmount: toNullableNumeric(row[6]),
      firstTransactionDate: toNullableDate(row[7]),
      lastTransactionDate: toNullableDate(row[8]),
      accountInfo: nullIfEmpty(row[9]),
      notes: nullIfEmpty(row[10]),
    }));

  console.log(`suppliers: importing ${records.length} rows...`);
  for (const batch of chunk(records)) {
    await db.insert(suppliers).values(batch);
    console.log(`  inserted batch of ${batch.length}`);
  }
  console.log(`suppliers: done (${records.length} rows).`);
}

async function main() {
  const workbook = XLSX.readFile(SEED_XLSX_PATH);
  await seedCustomers(workbook);
  await seedSuppliers(workbook);
  process.exit(0);
}

main().catch((error) => {
  console.error("customers/suppliers seed failed:", error);
  process.exit(1);
});
