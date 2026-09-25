import Link from "next/link";

// 대시보드 상세 페이지(견적 진행/시안·발주/출고 예정/미입금)에서 공통으로 쓰는 목록 UI.
export function ListSection({
  title,
  emptyText,
  count,
  children,
}: {
  title: string;
  emptyText: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold text-neutral-700">{title}</h3>
        {count > 0 && (
          <span className="rounded-full bg-[#8E1F3B] px-1.5 py-0.5 text-[10px] font-bold text-white">{count}</span>
        )}
      </div>
      {count === 0 ? (
        <p className="text-xs text-neutral-400">{emptyText}</p>
      ) : (
        <div className="flex flex-col gap-1.5">{children}</div>
      )}
    </div>
  );
}

export function ListRow({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm hover:border-neutral-300 hover:bg-white"
    >
      {children}
    </Link>
  );
}

export function DetailHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <Link href="/dashboard" className="text-sm text-neutral-500 hover:underline">
        ← 대시보드
      </Link>
      <h1 className="mt-1 text-xl font-semibold text-neutral-900">{title}</h1>
      <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
    </div>
  );
}
