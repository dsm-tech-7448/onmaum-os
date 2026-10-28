import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projects, customers, quotes, notificationLog } from "@/db/schema";

// 프로젝트를 만들 때는 고객사명을 모르는 경우가 있어(예: 문의 아이디/임시 번호로 먼저 등록)
// 나중에 견적서 리비전에서 진짜 고객사명을 입력해도 프로젝트 제목(projects.customer_id →
// customers.company_name)은 그대로 옛 이름으로 남았다(2026-10-12 피드백). 견적서를 저장할
// 때마다 이 함수로 프로젝트의 고객사를 견적서의 고객사명에 맞춰 다시 연결한다.
//
// 한 프로젝트에 서로 다른 고객의 견적이 여러 건 걸릴 수 있어서(Summary 요청사항 분리
// 사례), 다른 견적번호 중에 "프로젝트 현재 고객사도 아니고 새 이름도 아닌" 진짜 다른
// 고객사로 보이는 견적이 있으면 건드리지 않는다. 같은 이름의 고객사가 이미 있으면 그
// 고객사로 연결하고, 없으면 새로 만든다. 옛 이름의 고객사 행은 "프로젝트 만들 때 이름만 넣고
// 급하게 등록한 임시 고객사"(이름 외 정보가 전혀 없고 다른 프로젝트/알림에서 안 쓰는 경우)일
// 때만 지운다 — 고객 목록에 "1282" 같은 임시 이름이 계속 남지 않게. 실제 고객 정보가 한
// 칸이라도 있거나 다른 곳에서 쓰이는 고객사는 절대 지우지 않는다.
export async function syncProjectCustomerWithQuote(
  projectId: string,
  quoteNumber: string,
  rawCustomerName: string
): Promise<boolean> {
  const newName = rawCustomerName.trim();
  if (!newName) return false;

  const [project] = await db
    .select({ customerId: customers.id, customerName: customers.companyName })
    .from(projects)
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.customerName === newName) return false;

  const quoteRows = await db
    .select({ quoteNumber: quotes.quoteNumber, revision: quotes.revision, customerName: quotes.customerName })
    .from(quotes)
    .where(eq(quotes.projectId, projectId));
  const latestByNumber = new Map<string, (typeof quoteRows)[number]>();
  for (const q of quoteRows) {
    if (q.quoteNumber === quoteNumber) continue;
    const existing = latestByNumber.get(q.quoteNumber);
    if (!existing || q.revision > existing.revision) latestByNumber.set(q.quoteNumber, q);
  }
  const hasOtherCustomerQuote = [...latestByNumber.values()].some((q) => {
    const n = q.customerName.trim();
    return n !== "" && n !== project.customerName && n !== newName;
  });
  if (hasOtherCustomerQuote) return false;

  const [existing] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.companyName, newName))
    .limit(1);
  const customerId =
    existing?.id ??
    (await db.insert(customers).values({ companyName: newName }).returning({ id: customers.id }))[0].id;

  await db.update(projects).set({ customerId, updatedAt: new Date() }).where(eq(projects.id, projectId));
  await deletePlaceholderCustomerIfUnused(project.customerId);
  return true;
}

async function deletePlaceholderCustomerIfUnused(customerId: string): Promise<void> {
  const [old] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!old) return;
  const isBlank =
    !old.businessNumber && !old.contactName && !old.mobilePhone && !old.officePhone && !old.email &&
    !old.address && !old.acquisitionChannel && !old.notes && !old.customerGrade && !old.assignedSalesRep &&
    old.transactionCount === 0 && old.totalAmount == null && !old.firstTransactionDate && !old.lastTransactionDate;
  if (!isBlank) return;
  const [usedByProject] = await db.select({ id: projects.id }).from(projects).where(eq(projects.customerId, customerId)).limit(1);
  if (usedByProject) return;
  const [usedByNotice] = await db.select({ id: notificationLog.id }).from(notificationLog).where(eq(notificationLog.customerId, customerId)).limit(1);
  if (usedByNotice) return;
  await db.delete(customers).where(and(eq(customers.id, customerId), isNull(customers.businessNumber)));
}
