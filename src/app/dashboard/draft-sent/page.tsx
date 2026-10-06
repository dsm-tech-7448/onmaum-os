import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getUnsentDrafts } from "@/lib/dashboard/queries";
import { DetailHeader, ListSection, ListRow } from "../list-parts";

export default async function DraftSentPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const unsentDrafts = await getUnsentDrafts();

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <DetailHeader title="시안 발송" subtitle="시안은 작성됐지만 아직 고객에게 발송하지 않은 프로젝트입니다." />

        <ListSection title="시안 발송 필요" emptyText="해당 건이 없습니다." count={unsentDrafts.length}>
          {unsentDrafts.map((p) => (
            <ListRow key={p.projectId} href={`/projects/${p.projectId}/drafts`}>
              <span className="font-mono text-xs font-medium text-neutral-900">{p.projectNumber}</span>
              <span className="text-neutral-600"> {p.customerName}</span>
            </ListRow>
          ))}
        </ListSection>
      </div>
    </main>
  );
}
