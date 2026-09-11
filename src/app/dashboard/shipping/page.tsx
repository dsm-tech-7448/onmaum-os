import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getPOsDueToday, getOverdueUnshippedPos } from "@/lib/dashboard/queries";
import { DetailHeader, ListSection, ListRow } from "../list-parts";

export default async function ShippingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [dueToday, overdue] = await Promise.all([getPOsDueToday(), getOverdueUnshippedPos()]);

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <DetailHeader title="출고 예정" subtitle="발송요청일이 오늘이거나 이미 지났는데 아직 송장번호가 없는 발주입니다." />

        <ListSection
          title="오늘 발송요청일 (공급업체 출고 확인 필요)"
          emptyText="해당 건이 없습니다."
          count={dueToday.length}
        >
          {dueToday.map((po) => (
            <ListRow key={`${po.projectId}-${po.poNumber}`} href={`/projects/${po.projectId}/purchase-orders`}>
              <span className="font-mono text-xs font-medium text-neutral-900">{po.poNumber}</span>
              <span className="text-neutral-600"> {po.customerName}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">
                {po.supplierName || "공급업체 미입력"} · 발송요청일 {po.reqDate} (오늘)
              </span>
            </ListRow>
          ))}
        </ListSection>

        <ListSection title="발송요청일이 지난 미배송 발주" emptyText="해당 건이 없습니다." count={overdue.length}>
          {overdue.map((po) => (
            <ListRow key={`${po.projectId}-${po.poNumber}`} href={`/projects/${po.projectId}/purchase-orders`}>
              <span className="font-mono text-xs font-medium text-neutral-900">{po.poNumber}</span>
              <span className="text-neutral-600"> {po.customerName}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">
                {po.supplierName || "공급업체 미입력"} · 발송요청일 {po.reqDate} (지남)
              </span>
            </ListRow>
          ))}
        </ListSection>
      </div>
    </main>
  );
}
