import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/db";
import { projects, projectStages, customers } from "@/db/schema";
import { StageProgress } from "@/components/stage-progress";

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
                      <p className="text-sm text-neutral-600">{p.customerName}</p>
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
