import { sql } from "drizzle-orm";
import { db } from "@/db";
import { quotes } from "@/db/schema";

/**
 * QT-{YYYYMMDD}-{4자리} 형식(견적번호 자체는 영문 유지 — 2026-09-10, 다운로드 파일명만
 * 한글 "견적서-"로 표기하고 견적번호 필드는 QT-로 구분해달라는 피드백). 그 날짜의 마지막
 * 순번 다음 값을 DB에서 조회해 프로젝트 간에도 겹치지 않게 한다.
 */
export async function generateQuoteNumber(date = new Date()) {
  const compact = date.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `QT-${compact}-`;

  const [row] = await db
    .select({ maxNumber: sql<string | null>`max(${quotes.quoteNumber})` })
    .from(quotes)
    .where(sql`${quotes.quoteNumber} like ${prefix + "%"}`);

  const lastSeq = row?.maxNumber ? Number.parseInt(row.maxNumber.slice(prefix.length), 10) : 0;
  const nextSeq = Number.isNaN(lastSeq) ? 1 : lastSeq + 1;

  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}
