import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/db";
import { projects, projectStages, customers, quotes, quoteItems } from "@/db/schema";
import { StageProgress } from "@/components/stage-progress";

// 같은 고객사가 프로젝트를 여러 건 진행할 때(예: 같은 기관이 다른 상품을 여러 번 문의)
// 목록에서 구분이 안 된다는 요청(2026-09-29) — 프로젝트별로 가장 최근 견적의 상품명을
// 함께 보여준다. 한 프로젝트에 견적이 여러 건(리비전 아니라 번호 자체가 다른 경우)일
// 수 있어 "가장 최근에 저장된 견적"을 대표로 삼는다([[project_draft_default_quote]]와
// 같은 기준).
async function getProjectProductNames(projectIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (projectIds.length === 0) return result;

  const quoteRows = await db
    .select({
      id: quotes.id,
      projectId: quotes.projectId,
      compareProductName: quotes.compareProductName,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .where(inArray(quotes.projectId, projectIds))
    .orderBy(desc(quotes.createdAt));

  // 프로젝트별 가장 최근 견적 하나만 남긴다(위에서 이미 최신순 정렬했으니 처음 나오는 것).
  const latestQuoteByProject = new Map<string, (typeof quoteRows)[number]>();
  for (const q of quoteRows) {
    if (!latestQuoteByProject.has(q.projectId)) latestQuoteByProject.set(q.projectId, q);
  }
  const latestQuotes = Array.from(latestQuoteByProject.values());
  if (latestQuotes.length === 0) return result;

  const itemRows = await db
    .select({
      quoteId: quoteItems.quoteId,
      name: quoteItems.name,
      lineType: quoteItems.lineType,
    })
    .from(quoteItems)
    .where(
      and(
        inArray(
          quoteItems.quoteId,
          latestQuotes.map((q) => q.id)
        ),
        sql`${quoteItems.tierId} is null`
      )
    )
    .orderBy(quoteItems.sortOrder);

  const firstProduct = new Map<string, string>();
  const firstAny = new Map<string, string>();
  for (const row of itemRows) {
    if (!firstAny.has(row.quoteId)) firstAny.set(row.quoteId, row.name);
    if (row.lineType === "product" && !firstProduct.has(row.quoteId)) {
      firstProduct.set(row.quoteId, row.name);
    }
  }

  for (const q of latestQuotes) {
    const name = (q.compareProductName && q.compareProductName.trim()) || firstProduct.get(q.id) || firstAny.get(q.id) || "";
    if (name) result.set(q.projectId, name);
  }
  return result;
}

// 찾기(2026-10-30) — 고객사명뿐 아니라 상품명으로도 찾는다. 목록은 기본 최근 100건만 불러오므로
// 검색어가 있을 땐 전체 프로젝트에서 찾는다. 상품명은 어느 견적(리비전 포함)의 품목명이나 비교견적
// 상품명에 들어 있어도 걸린다 — 목록에 보이는 대표 상품명(가장 최근 견적)과 달라도 찾을 수 있게.
function projectSearchCondition(q: string) {
  const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  return or(
    ilike(customers.companyName, like),
    ilike(projects.projectNumber, like),
    sql`exists (select 1 from ${quotes} where ${quotes.projectId} = ${projects.id} and ${quotes.compareProductName} ilike ${like})`,
    sql`exists (select 1 from ${quotes} inner join ${quoteItems} on ${quoteItems.quoteId} = ${quotes.id} where ${quotes.projectId} = ${projects.id} and ${quoteItems.name} ilike ${like})`
  );
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const stages = await db
    .select()
    .from(projectStages)
    .orderBy(projectStages.sortOrder);

  const { q: rawQ } = await searchParams;
  const q = (Array.isArray(rawQ) ? rawQ[0] : rawQ)?.trim() ?? "";

  const rows = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      requiresDraft: projects.requiresDraft,
      createdAt: projects.createdAt,
      customerName: customers.companyName,
      currentStageSortOrder: projectStages.sortOrder,
    })
    .from(projects)
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .leftJoin(projectStages, eq(projects.currentStageId, projectStages.id))
    .where(q ? projectSearchCondition(q) : undefined)
    .orderBy(desc(projects.createdAt))
    .limit(q ? 300 : 100);

  const productNames = await getProjectProductNames(rows.map((r) => r.id));

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">프로젝트</h1>
            <p className="mt-1 text-sm text-neutral-500">
              고객 문의 → 견적 → 시안 → 발주 → 거래명세서 → 영수증 → 배송 8단계 진행 현황
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
            >
              대시보드
            </Link>
            <Link
              href="/projects/new"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
            >
              + 새 프로젝트
            </Link>
          </div>
        </div>

        <form method="get" className="mb-4 flex items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="고객사명 · 상품명 · 프로젝트 번호로 찾기"
            className="w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
          />
          <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
            찾기
          </button>
          {q && (
            <Link href="/projects" className="text-sm text-neutral-500 underline">
              검색 지우기
            </Link>
          )}
        </form>
        {q && (
          <p className="mb-3 text-xs text-neutral-500">
            &quot;{q}&quot; 검색 결과 {rows.length}건{rows.length >= 300 ? " (최대 300건까지만 표시)" : ""}
          </p>
        )}

        {rows.length === 0 && q ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
            &quot;{q}&quot;에 해당하는 프로젝트가 없습니다.
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
            아직 프로젝트가 없습니다.{" "}
            <Link href="/projects/new" className="text-neutral-900 underline">
              첫 프로젝트를 만들어보세요
            </Link>
            .
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="block rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-neutral-300 hover:shadow"
                >
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div>
                      <p className="font-mono text-sm font-medium text-neutral-900">
                        {p.projectNumber}
                      </p>
                      <p className="text-sm text-neutral-600">
                        {p.customerName}
                        {productNames.get(p.id) && (
                          <span className="text-neutral-400"> · {productNames.get(p.id)}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-neutral-400">
                      {!p.requiresDraft && (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5">
                          시안 생략
                        </span>
                      )}
                      <span>{p.createdAt.toLocaleDateString("ko-KR")}</span>
                    </div>
                  </div>
                  <StageProgress
                    stages={stages}
                    currentSortOrder={p.currentStageSortOrder}
                    requiresDraft={p.requiresDraft}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
