"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setPoCustomerNotified } from "@/app/projects/[id]/production/actions";

// 출고 예정 목록의 한 줄 — 왼쪽 체크박스로 "고객 통보 완료"를 바로 체크하면 목록에서 빠진다
// (알림톡/송장번호 입력은 현실적으로 어려워 통보 여부만 체크한다).
export function NotifyRow({
  poId,
  href,
  poNumber,
  customerName,
  detail,
}: {
  poId: string;
  href: string;
  poNumber: string;
  customerName: string;
  detail: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");

  function toggle(next: boolean) {
    setChecked(next);
    setError("");
    startTransition(async () => {
      const res = await setPoCustomerNotified(poId, next);
      if (!res.ok) {
        setChecked(!next);
        setError(res.error ?? "저장에 실패했습니다.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm ${
        checked ? "opacity-50" : ""
      }`}
    >
      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-medium text-green-700">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={checked}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
        />
        통보 완료
      </label>
      <Link href={href} className="min-w-0 flex-1 hover:underline">
        <span className="font-mono text-xs font-medium text-neutral-900">{poNumber}</span>
        <span className="text-neutral-600"> {customerName}</span>
        <span className="mt-0.5 block text-xs text-neutral-500">{detail}</span>
        {error && <span className="block text-xs text-red-600">{error}</span>}
      </Link>
    </div>
  );
}
