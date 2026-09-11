"use client";

import { useState } from "react";
import {
  addProjectRequest,
  listProjectRequests,
  resolveProjectRequest,
  type ProjectRequestItem,
} from "./requests-actions";

export function RequestsWidget({
  projectId,
  initialRequests,
}: {
  projectId: string;
  initialRequests: ProjectRequestItem[];
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"customer" | "supplier">("customer");
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const unresolved = requests.filter((r) => !r.resolvedAt);

  async function refresh() {
    const rows = await listProjectRequests(projectId);
    setRequests(rows);
  }

  async function handleAdd() {
    if (!content.trim()) return;
    setIsSaving(true);
    try {
      await addProjectRequest(projectId, source, content);
      setContent("");
      await refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleResolve(id: string) {
    await resolveProjectRequest(id);
    await refresh();
  }

  return (
    <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-medium text-neutral-900">
          요청사항
          {unresolved.length > 0 && (
            <span className="ml-2 rounded-full bg-[#8E1F3B] px-1.5 py-0.5 text-[10px] font-bold text-white">
              {unresolved.length}
            </span>
          )}
        </span>
        <span className="text-xs text-neutral-400">{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>

      {open && (
        <div className="mt-3">
          <div className="mb-3 flex gap-2">
            <select
              className="rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
              value={source}
              onChange={(e) => setSource(e.target.value as "customer" | "supplier")}
            >
              <option value="customer">고객</option>
              <option value="supplier">공급업체</option>
            </select>
            <input
              className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-xs"
              placeholder="요청 내용을 입력하세요"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={isSaving || !content.trim()}
              className="rounded-md bg-[#8E1F3B] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              추가
            </button>
          </div>

          {requests.length === 0 ? (
            <p className="text-xs text-neutral-400">기록된 요청사항이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {requests.map((r) => (
                <div
                  key={r.id}
                  className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs ${
                    r.resolvedAt ? "bg-neutral-50 text-neutral-400 line-through" : "bg-neutral-100 text-neutral-800"
                  }`}
                >
                  <span>
                    <span className="mr-1.5 rounded bg-neutral-200 px-1 text-[10px] no-underline">
                      {r.source === "customer" ? "고객" : "공급업체"}
                    </span>
                    {r.content}
                  </span>
                  {!r.resolvedAt && (
                    <button
                      type="button"
                      onClick={() => handleResolve(r.id)}
                      className="ml-2 shrink-0 rounded bg-neutral-700 px-2 py-0.5 text-white no-underline"
                    >
                      해결됨
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
