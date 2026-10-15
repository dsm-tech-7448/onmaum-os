import { sql } from "drizzle-orm";
import { db } from "@/db";
import { taxInvoices } from "@/db/schema";

/**
 * TI-{YYYYMMDD}-{4자리} 형식. 다른 문서 번호 생성기와 동일한 규칙(하루 첫 순번은 0011부터,
 * 2026-09-15).
 */
export async function generateInvoiceNumber(date = new Date()) {
  const compact = date.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `TI-${compact}-`;

  const [row] = await db
    .select({ maxNumber: sql<string | null>`max(${taxInvoices.invoiceNumber})` })
    .from(taxInvoices)
    .where(sql`${taxInvoices.invoiceNumber} like ${prefix + "%"}`);

  const lastSeq = row?.maxNumber ? Number.parseInt(row.maxNumber.slice(prefix.length), 10) : 0;
  const nextSeq = Number.isNaN(lastSeq) || lastSeq < 10 ? 11 : lastSeq + 1;

  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}
