import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { DraftEditor } from "./draft-editor";
import { listDraftRevisions, listDraftNotifications, getInitialQuoteReference } from "./actions";

export default async function ProjectDraftsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id: projectId } = await params;

  const [project] = await db
    .select({ id: projects.id, requiresDraft: projects.requiresDraft })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) notFound();

  if (!project.requiresDraft) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        이 프로젝트는 인쇄 시안이 필요 없는 건이라(시안 생략) 시안 단계를 건너뜁니다.
      </div>
    );
  }

  const [revisions, notifications, quoteReference] = await Promise.all([
    listDraftRevisions(projectId),
    listDraftNotifications(projectId),
    getInitialQuoteReference(projectId),
  ]);

  return (
    <DraftEditor
      projectId={projectId}
      initialRevisions={revisions}
      initialNotifications={notifications}
      initialQuoteReference={quoteReference}
    />
  );
}
