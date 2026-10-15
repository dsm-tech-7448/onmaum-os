"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setRequiresDraft } from "./requires-draft-action";

export function RequiresDraftToggle({ projectId, requiresDraft }: { projectId: string; requiresDraft: boolean }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");

  async function handleChange(next: boolean) {
    setIsPending(true);
    setError("");
    try {
      await setRequiresDraft(projectId, next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "변경에 실패했습니다.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="mt-1.5">
      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-600">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 rounded border-neutral-300"
          checked={requiresDraft}
          disabled={isPending}
          onChange={(e) => handleChange(e.target.checked)}
        />
        인쇄 시안 필요
        <span className="text-neutral-400">(해제하면 시안 단계를 건너뛰고 바로 발주서를 작성할 수 있습니다)</span>
      </label>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
