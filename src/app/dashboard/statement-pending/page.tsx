import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getProjectsByPendingStage } from "@/lib/dashboard/queries";
import { DetailHeader, ListSection, ListRow } from "../list-parts";

export default async function StatementPendingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const groups = await getProjectsByPendingStage();
  const projects = groups.find((g) => g.stageSortOrder === 6)?.projects ?? [];

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <DetailHeader title="거래명세서 발송" subtitle="거래명세서를 아직 발송하지 않은 프로젝트입니다." />

        <ListSection title="거래명세서 발송 필요" emptyText="해당 건이 없습니다." count={projects.length}>
          {projects.map((p) => (
            <ListRow key={p.projectId} href={`/projects/${p.projectId}/transaction-statements`}>
              <span className="font-mono text-xs font-medium text-neutral-900">{p.projectNumber}</span>
              <span className="text-neutral-600"> {p.customerName}</span>
            </ListRow>
          ))}
        </ListSection>
      </div>
    </main>
  );
}
