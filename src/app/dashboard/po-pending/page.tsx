import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getProjectsMissingPO } from "@/lib/dashboard/queries";
import { DetailHeader, ListSection, ListRow } from "../list-parts";

export default async function PoPendingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const projects = await getProjectsMissingPO();

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <DetailHeader
          title="발주서 작성"
          subtitle="공급처 발주서를 아직 작성하지 않은 프로젝트입니다 (거래명세서를 발주보다 먼저 보낸 경우도 포함)."
        />

        <ListSection title="발주서 작성 필요" emptyText="해당 건이 없습니다." count={projects.length}>
          {projects.map((p) => (
            <ListRow key={p.projectId} href={`/projects/${p.projectId}/purchase-orders`}>
              <span className="font-mono text-xs font-medium text-neutral-900">{p.projectNumber}</span>
              <span className="text-neutral-600"> {p.customerName}</span>
            </ListRow>
          ))}
        </ListSection>
      </div>
    </main>
  );
}
