"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { projects, projectStages, projectStageLog, customers } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { generateProjectNumber } from "@/lib/projects/project-number";

// 고객사 검색(고객 마스터, Daily Summary 이력 기준)에 없는 신규 고객사를 새 프로젝트
// 화면에서 바로 등록할 수 있게 한다 — 지금까지는 검색-선택만 가능해서 마스터에 없는
// 고객사는 프로젝트를 아예 만들 수 없었다(2026-09-10 발견). 상호명만 필수로 받고
// 나머지(연락처 등)는 나중에 고객 정보 화면에서 채우면 된다.
const createCustomerSchema = z.object({
  companyName: z.string().trim().min(1, "고객사명을 입력해주세요."),
});

export type QuickCustomer = { id: string; companyName: string; contactName: string | null; customerGrade: string | null };

export async function createCustomerQuick(companyName: string): Promise<QuickCustomer> {
  const session = await getSession();
  if (!session) redirect("/login");

  const parsed = createCustomerSchema.parse({ companyName });

  const [created] = await db
    .insert(customers)
    .values({ companyName: parsed.companyName })
    .returning({ id: customers.id, companyName: customers.companyName, contactName: customers.contactName, customerGrade: customers.customerGrade });

  return created;
}

const createProjectSchema = z.object({
  customerId: z.string().uuid("고객사를 선택해주세요."),
  requiresDraft: z.preprocess((v) => v === "on", z.boolean()),
});

export type CreateProjectState = {
  error?: string;
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export async function createProject(
  _prevState: CreateProjectState,
  formData: FormData
): Promise<CreateProjectState> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const parsed = createProjectSchema.safeParse({
    customerId: formData.get("customerId"),
    requiresDraft: formData.get("requiresDraft"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };
  }

  const [inquiryStage] = await db
    .select()
    .from(projectStages)
    .where(eq(projectStages.stageCode, "inquiry"))
    .limit(1);

  if (!inquiryStage) {
    return {
      error: "'고객 문의' 단계(project_stages)가 없습니다. db:seed-project-stages를 먼저 실행해주세요.",
    };
  }

  let projectId: string | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3 && !projectId; attempt++) {
    const projectNumber = await generateProjectNumber();
    try {
      const [created] = await db
        .insert(projects)
        .values({
          projectNumber,
          customerId: parsed.data.customerId,
          currentStageId: inquiryStage.id,
          requiresDraft: parsed.data.requiresDraft,
        })
        .returning({ id: projects.id });
      projectId = created.id;
    } catch (error) {
      lastError = error;
      if (!isUniqueViolation(error)) break;
    }
  }

  if (!projectId) {
    console.error("createProject failed:", lastError);
    return { error: "프로젝트 생성에 실패했습니다. 잠시 후 다시 시도해주세요." };
  }

  await db.insert(projectStageLog).values({
    projectId,
    stageId: inquiryStage.id,
    changedBy: session.userId,
  });

  redirect("/projects");
}
