"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteProject } from "./delete-project-action";

export function DeleteProjectButton({ projectId, projectNumber }: { projectId: string; projectNumber: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    const typed = window.prompt(
      `이 프로젝트(${projectNumber})를 완전히 삭제합니다.\n` +
        `견적서·시안·발주서·거래명세서·세금계산서·제작 기록이 모두 함께 삭제되며 되돌릴 수 없습니다.\n\n` +
        `계속하려면 프로젝트 번호를 정확히 입력하세요: ${projectNumber}`
    );
    if (typed === null) return;
    if (typed.trim() !== projectNumber) {
      window.alert("프로젝트 번호가 일치하지 않아 삭제를 취소했습니다.");
      return;
    }

    setIsDeleting(true);
    setError("");
    try {
      const result = await deleteProject(projectId);
      if (result.ok) {
        router.push("/projects");
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={handleDelete}
        disabled={isDeleting}
        className="text-[11px] text-red-500 underline hover:text-red-700 disabled:opacity-50"
      >
        {isDeleting ? "삭제 중..." : "🗑️ 프로젝트 삭제"}
      </button>
      {error && <p className="mt-1 max-w-[220px] text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
