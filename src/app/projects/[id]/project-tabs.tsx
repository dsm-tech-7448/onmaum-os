"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ProjectTabs({ projectId, showDrafts }: { projectId: string; showDrafts: boolean }) {
  const pathname = usePathname();

  const tabs = [
    { href: `/projects/${projectId}/quotes`, label: "견적서 작성" },
    ...(showDrafts ? [{ href: `/projects/${projectId}/drafts`, label: "시안 작성" }] : []),
    { href: `/projects/${projectId}/purchase-orders`, label: "발주서 작성" },
    { href: `/projects/${projectId}/transaction-statements`, label: "거래명세서 발송" },
    { href: `/projects/${projectId}/tax-invoices`, label: "세금계산서 발행" },
    { href: `/projects/${projectId}/production`, label: "제작·배송" },
  ];

  return (
    <div className="mb-5 flex gap-1 rounded-md bg-neutral-100 p-1 w-fit">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              active ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
