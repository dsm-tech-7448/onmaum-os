import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { db } from "@/db";
import { companyProfile } from "@/db/schema";
import { logout } from "../login/actions";
import { getDashboardSummary } from "@/lib/dashboard/summary";

function won(v: number): string {
  return `${Math.round(v).toLocaleString("ko-KR")}원`;
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const [profile, { counts, period, upcomingPeakSeason }] = await Promise.all([
    db.select().from(companyProfile).limit(1).catch(() => []),
    getDashboardSummary(),
  ]);
  const companyProfileRow = profile[0];
  const nextMonthLabel = `${((new Date().getMonth() + 1) % 12) + 1}월`;

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">
              {companyProfileRow?.brandName ?? "온마음 OS"} 대시보드
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              {session.name}님 ({session.email}) · {session.role}
            </p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              로그아웃
            </button>
          </form>
        </div>

        <div className="mb-6 flex gap-4 text-sm">
          <Link href="/projects" className="text-neutral-600 underline">
            프로젝트 전체 보기 →
          </Link>
          <Link href="/dashboard/summary" className="text-neutral-600 underline">
            Summary 보기 →
          </Link>
        </div>

        <h2 className="mb-3 text-sm font-semibold text-neutral-900">오늘의 할 일 (To Do)</h2>
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <KpiCard label="견적 발송" count={counts.quoteSent} href="/dashboard/quotes-in-progress" color="blue" />
          <KpiCard label="시안 발송" count={counts.draftSent} href="/dashboard/draft-sent" color="indigo" />
          <KpiCard label="발주서 작성" count={counts.poPending} href="/dashboard/po-pending" color="violet" />
          <KpiCard
            label="거래명세서 발송"
            count={counts.statementPending}
            href="/dashboard/statement-pending"
            color="fuchsia"
          />
          <KpiCard label="영수증 발행" count={counts.receiptPending} href="/dashboard/receipt-pending" color="cyan" />
          <KpiCard label="배송" count={counts.shippingDue} href="/dashboard/shipping" color="orange" />
          <KpiCard label="미입금" count={counts.unpaidCustomer} href="/dashboard/unpaid" color="rose" />
          <KpiCard label="미출금" count={counts.unpaidSupplier} href="/dashboard/unpaid-supplier" color="amber" />
        </div>

        <h2 className="mb-3 text-sm font-semibold text-neutral-900">실적</h2>
        <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <PeriodCard title="이번 주" subtitle={period.weekLabel} stat={period.week} color="emerald" />
          <PeriodCard title="이번 달" subtitle={period.monthLabel} stat={period.month} color="sky" />
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-5">
            <p className="text-xs font-medium text-rose-500">미수금 합계 (매일 자동 갱신)</p>
            <p className="mt-2 text-3xl font-bold text-rose-700">{won(period.outstandingTotal)}</p>
            <Link href="/dashboard/unpaid" className="mt-3 inline-block text-xs text-rose-600 underline">
              미수 내역 보기 →
            </Link>
          </div>
        </div>

        <h2 className="mb-3 text-sm font-semibold text-neutral-900">다가오는 성수기 고객</h2>
        <div className="mb-8 rounded-xl border border-purple-200 bg-purple-50 p-5">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-medium text-purple-500">
              과거 구매 이력상 다음 달({nextMonthLabel})이 개인 성수기인 고객 — 지금 미리 연락하면 1개월 전 안내가 됩니다.
            </p>
            <p className="text-2xl font-bold text-purple-700">{upcomingPeakSeason.length}명</p>
          </div>
          {upcomingPeakSeason.length === 0 ? (
            <p className="mt-3 text-xs text-neutral-500">다음 달이 개인 성수기인 고객이 없습니다.</p>
          ) : (
            <>
              <ul className="mt-3 flex flex-wrap gap-2 text-xs">
                {upcomingPeakSeason.slice(0, 12).map((c) => (
                  <li key={c.customerId} className="rounded-full bg-white px-2.5 py-1 text-purple-700 shadow-sm">
                    {c.companyName}
                  </li>
                ))}
                {upcomingPeakSeason.length > 12 && (
                  <li className="rounded-full bg-white px-2.5 py-1 text-purple-500 shadow-sm">
                    외 {upcomingPeakSeason.length - 12}명
                  </li>
                )}
              </ul>
              <Link href="/dashboard/peak-season" className="mt-3 inline-block text-xs text-purple-600 underline">
                전체 명단 + 연락처 보기 →
              </Link>
            </>
          )}
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          <h2 className="text-sm font-medium text-neutral-900">자사 기준정보</h2>
          {companyProfileRow ? (
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Field label="상호" value={companyProfileRow.companyName} />
              <Field label="대표자" value={companyProfileRow.ceoName} />
              <Field label="사업자등록번호" value={companyProfileRow.businessNumber} />
              <Field label="전화" value={companyProfileRow.phone} />
            </dl>
          ) : (
            <p className="mt-4 text-sm text-neutral-500">
              company_profile 데이터가 아직 없습니다. DATABASE_URL 연결 후{" "}
              <code className="rounded bg-neutral-100 px-1 py-0.5">npm run db:seed</code>{" "}
              를 실행해주세요.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

const KPI_COLORS = {
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
  fuchsia: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-700",
  orange: "border-orange-200 bg-orange-50 text-orange-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
} as const;

function KpiCard({
  label,
  count,
  href,
  color,
}: {
  label: string;
  count: number;
  href: string;
  color: keyof typeof KPI_COLORS;
}) {
  return (
    <Link
      href={href}
      className={`block rounded-xl border p-4 text-center transition hover:shadow-md ${KPI_COLORS[color]}`}
    >
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-bold">{count}건</p>
    </Link>
  );
}

const PERIOD_COLORS = {
  emerald: { border: "border-emerald-200", bg: "bg-emerald-50", text: "text-emerald-700", label: "text-emerald-500" },
  sky: { border: "border-sky-200", bg: "bg-sky-50", text: "text-sky-700", label: "text-sky-500" },
} as const;

function PeriodCard({
  title,
  subtitle,
  stat,
  color,
}: {
  title: string;
  subtitle: string;
  stat: { revenue: number; cost: number; profit: number; count: number };
  color: keyof typeof PERIOD_COLORS;
}) {
  const c = PERIOD_COLORS[color];
  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-5`}>
      <div className="flex items-baseline justify-between">
        <p className={`text-xs font-medium ${c.label}`}>{title}</p>
        <p className="text-xs text-neutral-400">{subtitle}</p>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <p className={`text-2xl font-bold ${c.text}`}>{won(stat.revenue)}</p>
        <p className="text-xs text-neutral-500">매출액</p>
      </div>
      <p className="text-xs text-neutral-500">매출 건수 {stat.count}건</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-neutral-400">매입액</dt>
          <dd className="font-medium text-neutral-800">{won(stat.cost)}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">매출이익</dt>
          <dd className="font-medium text-neutral-800">{won(stat.profit)}</dd>
        </div>
      </dl>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-neutral-400">{label}</dt>
      <dd className="text-neutral-800">{value ?? "-"}</dd>
    </div>
  );
}
