import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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

export default async function ProjectsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const stages = await db
    .select()
    .from(projectStages)
    .orderBy(projectStages.sortOrder);

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
    .orderBy(desc(projects.createdAt))
    .limit(100);

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

        {rows.length === 0 ? (
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
