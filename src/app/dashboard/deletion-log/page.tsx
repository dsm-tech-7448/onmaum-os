import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listDeletionLog } from "@/lib/audit/deletion-log";

const ENTITY_LABEL: Record<string, string> = {
  project: "프로젝트",
  quote: "견적서",
  daily_summary_entry: "Daily Summary 행",
};

export default async function DeletionLogPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") {
    return (
      <main className="min-h-screen bg-neutral-50 px-6 py-10">
        <div className="mx-auto max-w-3xl rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          이 화면은 관리자만 볼 수 있습니다.
        </div>
      </main>
    );
  }

  const entries = await listDeletionLog();

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/dashboard" className="text-xs text-neutral-500 underline">
          ← 대시보드
        </Link>
        <h1 className="mt-2 mb-1 text-xl font-semibold text-neutral-900">삭제 이력</h1>
        <p className="mb-6 text-sm text-neutral-500">
          프로젝트·견적서·Daily Summary 행 삭제는 관리자만 할 수 있고, 여기에 누가 언제 무엇을
          지웠는지 기록됩니다.
        </p>

        {entries.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
            아직 삭제된 항목이 없습니다.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((e) => (
              <li key={e.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="mr-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">
                      {ENTITY_LABEL[e.entityType] ?? e.entityType}
                    </span>
                    <span className="text-sm font-medium text-neutral-900">{e.entityLabel}</span>
                  </div>
                  <span className="shrink-0 text-xs text-neutral-400">
                    {e.deletedAt.toLocaleString("ko-KR")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {e.deletedByName ?? "(이름 없음)"} ({e.deletedByEmail})
                </p>
                {e.snapshot != null && (
                  <p className="mt-1 text-[11px] text-neutral-400">{JSON.stringify(e.snapshot)}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
