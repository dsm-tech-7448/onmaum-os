import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getMissingCustomerPayments, getOutstandingBalances } from "@/lib/dashboard/queries";
import { DetailHeader, ListSection, ListRow } from "../list-parts";

export default async function UnpaidPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [missingPayments, outstanding] = await Promise.all([
    getMissingCustomerPayments(),
    getOutstandingBalances(),
  ]);

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <DetailHeader title="미입금" subtitle="고객 결제가 아직 확인되지 않은 건입니다." />

        <ListSection title="고객 결제 입력 필요" emptyText="해당 건이 없습니다." count={missingPayments.length}>
          {missingPayments.map((s) => (
            <ListRow key={s.statementNumber} href={`/projects/${s.projectId}/transaction-statements`}>
              <span className="font-mono text-xs font-medium text-neutral-900">{s.statementNumber}</span>
              <span className="text-neutral-600"> {s.customerName}</span>
            </ListRow>
          ))}
        </ListSection>

        <ListSection title="미수금 확인 필요" emptyText="미수금이 남은 건이 없습니다." count={outstanding.length}>
          {outstanding.map((s) => (
            <ListRow key={s.statementNumber} href={`/projects/${s.projectId}/transaction-statements`}>
              <span className="font-mono text-xs font-medium text-neutral-900">{s.statementNumber}</span>
              <span className="text-neutral-600"> {s.customerName}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">
                미수 {s.outstandingAmount.toLocaleString()}원
              </span>
            </ListRow>
          ))}
        </ListSection>
      </div>
    </main>
  );
}
