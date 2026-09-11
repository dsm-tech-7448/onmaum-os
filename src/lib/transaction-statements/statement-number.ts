import { sql } from "drizzle-orm";
import { db } from "@/db";
import { transactionStatements } from "@/db/schema";

/**
 * TX-{YYYYMMDD}-{4자리} 형식(명세서 번호 자체는 영문 유지 — quote-number.ts 참고, 다운로드
 * 파일명만 한글 표기). quote-number.ts/po-number.ts와 동일한 규칙이되, 리비전이 없으므로
 * statement_number 자체가 전역 유일하다.
 */
export async function generateStatementNumber(date = new Date()) {
  const compact = date.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `TX-${compact}-`;

  const [row] = await db
    .select({ maxNumber: sql<string | null>`max(${transactionStatements.statementNumber})` })
    .from(transactionStatements)
    .where(sql`${transactionStatements.statementNumber} like ${prefix + "%"}`);

  const lastSeq = row?.maxNumber ? Number.parseInt(row.maxNumber.slice(prefix.length), 10) : 0;
  const nextSeq = Number.isNaN(lastSeq) ? 1 : lastSeq + 1;

  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}
