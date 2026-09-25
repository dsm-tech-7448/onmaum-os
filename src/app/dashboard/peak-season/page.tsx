import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getUpcomingPeakSeasonCustomers } from "@/lib/dashboard/queries";
import { DetailHeader } from "../list-parts";

export default async function PeakSeasonPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const customers = await getUpcomingPeakSeasonCustomers();
  const nextMonthLabel = `${((new Date().getMonth() + 1) % 12) + 1}월`;

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <DetailHeader
          title="다가오는 성수기 고객"
          subtitle={`과거 구매 이력(Daily Summary 기준정보)상 개인 성수기가 ${nextMonthLabel}인 고객입니다 — 지금 연락하면 성수기 1개월 전 안내가 됩니다.`}
        />

        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {customers.length === 0 ? (
            <p className="p-6 text-center text-sm text-neutral-400">다음 달이 개인 성수기인 고객이 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
                  <th className="px-4 py-2">기관명</th>
                  <th className="px-4 py-2">성수기</th>
                  <th className="px-4 py-2">담당자</th>
                  <th className="px-4 py-2">휴대폰</th>
                  <th className="px-4 py-2">사무실 전화</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.customerId} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-4 py-2 font-medium text-neutral-900">{c.companyName}</td>
                    <td className="px-4 py-2 text-neutral-600">{c.peakSeasonMonth}월</td>
                    <td className="px-4 py-2 text-neutral-600">{c.contactName || "-"}</td>
                    <td className="px-4 py-2 text-neutral-600">{c.mobilePhone || "-"}</td>
                    <td className="px-4 py-2 text-neutral-600">{c.officePhone || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
