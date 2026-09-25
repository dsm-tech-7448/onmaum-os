import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

// 이 환경엔 pg_dump/Docker가 없어서(둘 다 설치되어 있지 않음) postgres.js로 직접
// 데이터를 읽어 INSERT문으로 직렬화한다. 스키마(테이블 구조)는 src/db/schema.ts에
// git으로 버전관리되어 있으므로, 복구 시에는 (1) git으로 schema.ts 복원 →
// (2) `npm run db:push`로 스키마 재생성 → (3) 이 백업 파일을 psql/Supabase SQL
// Editor에서 실행, 순서로 데이터만 복원하면 된다.
//
// Transaction pooler(6543)는 세션 단위 기능이 제한적이라 db:push와 마찬가지로
// Session pooler(DATABASE_URL_MIGRATIONS, 5432)를 사용한다.

// FK 안전 순서. transaction_statements ↔ tax_invoices는 순환 참조라
// transaction_statements.tax_invoice_id는 일단 NULL로 넣고 tax_invoices 삽입 후
// UPDATE로 되채운다(아래 dumpTransactionStatements 참고).
const TABLE_ORDER = [
  "company_profile",
  "users",
  "customers",
  "suppliers",
  "project_stages",
  "projects",
  "project_stage_log",
  "option_master",
  "product_suggestions",
  "quotes",
  "quote_tiers",
  "quote_items",
  "drafts",
  "draft_images",
  "purchase_orders",
  "po_items",
  "transaction_statements", // 특수 처리 (아래)
  "statement_items",
  "tax_invoices",
  "tax_invoice_items",
  "production",
  "notification_log",
] as const;

function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

type Row = Record<string, unknown>;

function dumpInsert(table: string, rows: Row[], overrides: Record<string, string> = {}): string {
  if (rows.length === 0) return `-- ${table}: 0 rows\n\n`;
  const columns = Object.keys(rows[0]);
  const lines = rows.map((row) => {
    const values = columns
      .map((c) => (c in overrides ? overrides[c] : toSqlLiteral(row[c])))
      .join(", ");
    const colList = columns.map((c) => `"${c}"`).join(", ");
    return `INSERT INTO "${table}" (${colList}) VALUES (${values}) ON CONFLICT (id) DO NOTHING;`;
  });
  return `-- ${table}: ${rows.length} rows\n${lines.join("\n")}\n\n`;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL_MIGRATIONS(또는 DATABASE_URL)이 .env.local에 없습니다.");
  }

  const sql = postgres(dbUrl, { prepare: false });

  const backupsDir = join(__dirname, "..", "backups");
  mkdirSync(backupsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:T]/g, "-").replace(/\..+/, "");
  const outFile = join(backupsDir, `onmaum-os-data-${timestamp}.sql`);

  console.log("백업 시작...");

  let output = `-- 온마음 OS 데이터 백업 (${new Date().toISOString()})\n`;
  output += `-- 데이터 전용 백업입니다. 스키마는 git의 src/db/schema.ts + \`npm run db:push\`로 복원한 뒤\n`;
  output += `-- 이 파일을 실행하세요 (테이블은 FK 안전 순서로 이미 정렬되어 있습니다).\n\n`;
  output += `BEGIN;\n\n`;

  let deferredUpdates = "";

  for (const table of TABLE_ORDER) {
    const rows = (await sql.unsafe(`SELECT * FROM "${table}" ORDER BY id`)) as unknown as Row[];

    if (table === "transaction_statements") {
      // tax_invoice_id는 순환 FK라 일단 NULL로 넣고, tax_invoices 삽입 후 되채운다.
      output += dumpInsert(table, rows, { tax_invoice_id: "NULL" });
      const withInvoice = rows.filter((r) => r.tax_invoice_id !== null);
      if (withInvoice.length > 0) {
        deferredUpdates +=
          `-- transaction_statements.tax_invoice_id 되채우기 (순환 FK)\n` +
          withInvoice
            .map(
              (r) =>
                `UPDATE "transaction_statements" SET "tax_invoice_id" = ${toSqlLiteral(
                  r.tax_invoice_id
                )} WHERE "id" = ${toSqlLiteral(r.id)};`
            )
            .join("\n") +
          "\n\n";
      }
      console.log(`  ${table}: ${rows.length}행`);
      continue;
    }

    output += dumpInsert(table, rows);
    console.log(`  ${table}: ${rows.length}행`);
  }

  output += deferredUpdates;
  output += `COMMIT;\n`;

  writeFileSync(outFile, output, "utf-8");
  await sql.end();

  console.log(`백업 완료: ${outFile}`);
}

main().catch((error) => {
  console.error("백업 실패:", error);
  process.exit(1);
});
