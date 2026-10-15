import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getUnpaidSuppliers } from "@/lib/dashboard/queries";
import { DetailHeader, ListSection, ListRow } from "../list-parts";

export default async function UnpaidSupplierPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const unpaidSuppliers = await getUnpaidSuppliers();

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <DetailHeader title="미출금" subtitle="공급업체에 아직 입금하지 않은 건입니다." />

        <ListSection title="공급업체 입금 필요" emptyText="해당 건이 없습니다." count={unpaidSuppliers.length}>
          {unpaidSuppliers.map((po) => (
            <ListRow key={`${po.projectId}-${po.poNumber}`} href={`/projects/${po.projectId}/purchase-orders`}>
              <span className="font-mono text-xs font-medium text-neutral-900">{po.poNumber}</span>
              <span className="text-neutral-600"> {po.customerName}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">
                {po.supplierName} · {po.amount.toLocaleString()}원
              </span>
            </ListRow>
          ))}
        </ListSection>
      </div>
    </main>
  );
}
