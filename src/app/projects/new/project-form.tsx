"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createProject, type CreateProjectState } from "./actions";
import { CustomerSearch } from "./customer-search";

const initialState: CreateProjectState = {};

export function ProjectForm() {
  const [state, formAction, isPending] = useActionState(createProject, initialState);
  const [customerId, setCustomerId] = useState<string | null>(null);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-neutral-700">고객사</label>
        <CustomerSearch selectedId={customerId} onSelect={(c) => setCustomerId(c?.id ?? null)} />
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          name="requiresDraft"
          defaultChecked
          className="h-4 w-4 rounded border-neutral-300"
        />
        인쇄 시안이 필요한 프로젝트입니다 (물티슈 등 완제품만 나가는 건은 해제)
      </label>

      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending || !customerId}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50"
        >
          {isPending ? "생성 중..." : "프로젝트 생성"}
        </button>
        <Link
          href="/projects"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
        >
          취소
        </Link>
      </div>
    </form>
  );
}
