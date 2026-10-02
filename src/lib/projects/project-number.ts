import { sql } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";

/**
 * PJ-{연도}-{4자리 순번} 형식 (예: PJ-2026-0078).
 * 온마음OS_마스터_DB스키마_v3.md의 projects.project_number 예시를 따른다.
 * 연도별로 그 해 마지막 번호 다음 값을 사용 — 동시 생성 시 유니크 제약 충돌 가능성은
 * 호출부(createProject)에서 재시도로 처리한다.
 */
export async function generateProjectNumber(year = new Date().getFullYear()) {
  const prefix = `PJ-${year}-`;

  const [row] = await db
    .select({ maxNumber: sql<string | null>`max(${projects.projectNumber})` })
    .from(projects)
    .where(sql`${projects.projectNumber} like ${prefix + "%"}`);

  const lastSeq = row?.maxNumber ? Number.parseInt(row.maxNumber.slice(prefix.length), 10) : 0;
  const nextSeq = Number.isNaN(lastSeq) ? 1 : lastSeq + 1;

  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}
