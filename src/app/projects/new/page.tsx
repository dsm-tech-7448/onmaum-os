import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ProjectForm } from "./project-form";

export default async function NewProjectPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-xl">
        <h1 className="text-xl font-semibold text-neutral-900">새 프로젝트</h1>
        <p className="mt-1 text-sm text-neutral-500">
          고객 문의 단계로 프로젝트가 생성됩니다. 프로젝트 번호는 자동으로 부여됩니다.
        </p>

        <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-6">
          <ProjectForm />
        </div>
      </div>
    </main>
  );
}
