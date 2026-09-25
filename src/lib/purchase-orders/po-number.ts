import { sql } from "drizzle-orm";
import { db } from "@/db";
import { purchaseOrders } from "@/db/schema";

/**
 * PO-{YYYYMMDD}-{4자리} 형식(발주번호 자체는 영문 유지 — quote-number.ts 참고, 다운로드
 * 파일명만 한글 표기). quote-number.ts와 동일한 규칙(하루 첫 순번은 0011부터, 2026-09-15).
 */
export async function generatePoNumber(date = new Date()) {
  const compact = date.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `PO-${compact}-`;

  const [row] = await db
    .select({ maxNumber: sql<string | null>`max(${purchaseOrders.poNumber})` })
    .from(purchaseOrders)
    .where(sql`${purchaseOrders.poNumber} like ${prefix + "%"}`);

  const lastSeq = row?.maxNumber ? Number.parseInt(row.maxNumber.slice(prefix.length), 10) : 0;
  const nextSeq = Number.isNaN(lastSeq) || lastSeq < 10 ? 11 : lastSeq + 1;

  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}
