import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/db";
import { projects, customers, projectStages } from "@/db/schema";
import { StageProgress } from "@/components/stage-progress";
import { getNextStage } from "@/lib/projects/stage-transition";
import { ProjectTabs } from "./project-tabs";
import { RequestsWidget } from "./requests-widget";
import { listProjectRequests } from "./requests-actions";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;

  const [project] = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      requiresDraft: projects.requiresDraft,
      customerName: customers.companyName,
      currentStageSortOrder: projectStages.sortOrder,
    })
    .from(projects)
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .leftJoin(projectStages, eq(projects.currentStageId, projectStages.id))
    .where(eq(projects.id, id))
    .limit(1);

  if (!project) notFound();

  const stages = await db.select().from(projectStages).orderBy(projectStages.sortOrder);
  const nextStage = getNextStage(stages, project.currentStageSortOrder, project.requiresDraft);
  const requests = await listProjectRequests(id);

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <Link href="/projects" className="text-xs text-neutral-500 underline">
          ← 프로젝트 목록
        </Link>

        <div className="mt-2 mb-4 rounded-xl border border-neutral-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-sm font-medium text-neutral-900">{project.projectNumber}</p>
              <p className="text-sm text-neutral-600">{project.customerName}</p>
            </div>
            <div className="w-64">
              <StageProgress
                stages={stages}
                currentSortOrder={project.currentStageSortOrder}
                requiresDraft={project.requiresDraft}
              />
              <p className="mt-1.5 text-right text-[11px] text-neutral-400">
                {nextStage
                  ? `다음 단계: ${nextStage.sortOrder}. ${nextStage.stageName}`
                  : "마지막 단계입니다"}
              </p>
            </div>
          </div>
        </div>

        <RequestsWidget projectId={id} initialRequests={requests} />

        <ProjectTabs projectId={id} showDrafts={project.requiresDraft} />

        {children}
      </div>
    </main>
  );
}
