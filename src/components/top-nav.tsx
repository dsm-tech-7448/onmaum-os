import Link from "next/link";
import { getSession } from "@/lib/auth/session";

// 로그인 상태에서만 보이는 전역 상단 바 — 어느 화면에 있든 프로젝트 목록/Summary/Daily
// Summary로 바로 이동할 수 있게(2026-09-18, "이것은 최상단에 언제나 보이게 해줘" 피드백).
// 기존에는 이 링크들이 /dashboard 페이지 안에만 있어서 다른 화면에서는 대시보드로
// 먼저 돌아가야 했다. sticky로 스크롤해도 계속 보이게 둔다.
export async function TopNav() {
  const session = await getSession();
  if (!session) return null;

  const linkCls = "text-neutral-600 hover:text-[#8E1F3B] hover:underline whitespace-nowrap";

  return (
    <div className="sticky top-0 z-50 flex items-center gap-4 overflow-x-auto border-b border-neutral-200 bg-white px-6 py-2 text-xs">
      <Link href="/dashboard" className="shrink-0 font-semibold text-[#8E1F3B]">
        온마음 OS
      </Link>
      <Link href="/projects" className={linkCls}>
        프로젝트 전체 보기 →
      </Link>
      <Link href="/dashboard/summary" className={linkCls}>
        Summary 보기 →
      </Link>
      <Link href="/dashboard/daily-summary" className={linkCls}>
        Daily Summary (엑셀 원본 컬럼) 보기 →
      </Link>
    </div>
  );
}
