import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getProjectsByPendingStage } from "@/lib/dashboard/queries";
import { DetailHeader, ListSection, ListRow } from "../list-parts";

export default async function ReceiptPendingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const groups = await getProjectsByPendingStage();
  const projects = groups.find((g) => g.stageSortOrder === 7)?.projects ?? [];

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <DetailHeader
          title="영수증 발행"
          subtitle="세금계산서·현금영수증·카드결제 중 아직 아무것도 처리되지 않은 프로젝트입니다."
        />

        <ListSection title="영수증 발행 필요" emptyText="해당 건이 없습니다." count={projects.length}>
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
