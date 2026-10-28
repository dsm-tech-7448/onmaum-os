"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { drafts, draftImages, projects, customers, notificationLog, quotes } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { advanceProjectStage } from "@/lib/projects/stage-transition";
import {
  getQuoteReferenceById as getQuoteReferenceByIdShared,
  getQuoteReferenceByNumber as getQuoteReferenceByNumberShared,
  searchProjectQuotes,
} from "@/app/projects/[id]/quotes/actions";
import type {
  DraftImageDraft,
  DraftRevisionSummary,
  NotificationLogSummary,
  QuoteReferenceSummary,
  QuoteSearchResult,
} from "@/lib/drafts/types";

export async function searchQuotesForDraftLink(projectId: string, query: string): Promise<QuoteSearchResult[]> {
  return searchProjectQuotes(projectId, query);
}

// 견적 요약 조회 로직은 quotes/actions.ts에 있고(drafts/purchase-orders가 공유),
// "use server" 파일은 재-export가 아닌 실제 async 함수 선언만 허용하므로 얇게 감싼다.
export async function getQuoteReferenceById(quoteId: string): Promise<QuoteReferenceSummary | null> {
  return getQuoteReferenceByIdShared(quoteId);
}

export async function getQuoteReferenceByNumber(
  projectId: string,
  quoteNumber: string
): Promise<QuoteReferenceSummary | null> {
  return getQuoteReferenceByNumberShared(projectId, quoteNumber);
}

const DRAFT_SENT_TYPE = "시안발송";

async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  return session;
}

export async function listDraftRevisions(projectId: string): Promise<DraftRevisionSummary[]> {
  await requireSession();

  const rows = await db
    .select({
      id: drafts.id,
      revision: drafts.revision,
      note: drafts.note,
      isConfirmed: drafts.isConfirmed,
      confirmedAt: drafts.confirmedAt,
      createdAt: drafts.createdAt,
      quoteNumber: quotes.quoteNumber,
    })
    .from(drafts)
    .leftJoin(quotes, eq(drafts.quoteId, quotes.id))
    .where(eq(drafts.projectId, projectId))
    .orderBy(desc(drafts.revision));

  if (rows.length === 0) return [];

  const images = await db
    .select()
    .from(draftImages)
    .where(
      inArray(
        draftImages.draftId,
        rows.map((r) => r.id)
      )
    )
    .orderBy(draftImages.sortOrder);

  return rows.map((r) => ({
    id: r.id,
    revision: r.revision,
    note: r.note ?? "",
    isConfirmed: r.isConfirmed,
    confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    quoteNumber: r.quoteNumber,
    images: images
      .filter((img) => img.draftId === r.id)
      .map((img) => ({ id: img.id, imageDataUrl: img.imageDataUrl, caption: img.caption ?? "" })),
  }));
}

export type SaveDraftResult = { revision: number };

export async function saveDraft(
  projectId: string,
  note: string,
  images: DraftImageDraft[],
  quoteId: string | null
): Promise<SaveDraftResult> {
  const session = await requireSession();

  const [project] = await db
    .select({ requiresDraft: projects.requiresDraft })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  if (!project.requiresDraft) {
    throw new Error("이 프로젝트는 시안 단계가 없습니다(requires_draft=false).");
  }
  if (!quoteId) {
    throw new Error("시안을 저장하려면 먼저 견적서를 불러와 어느 견적에 대한 시안인지 선택해주세요.");
  }

  const validImages = images.filter((img) => img.imageDataUrl.trim() !== "");
  if (validImages.length === 0) throw new Error("시안 이미지를 1개 이상 첨부해주세요.");

  const [{ maxRevision }] = await db
    .select({ maxRevision: sql<number | null>`max(${drafts.revision})` })
    .from(drafts)
    .where(eq(drafts.projectId, projectId));

  const nextRevision = (maxRevision ?? 0) + 1;

  const [created] = await db
    .insert(drafts)
    .values({
      projectId,
      revision: nextRevision,
      note: note || null,
      quoteId,
      createdBy: session.userId,
    })
    .returning({ id: drafts.id });

  await db.insert(draftImages).values(
    validImages.map((img, idx) => ({
      draftId: created.id,
      imageDataUrl: img.imageDataUrl,
      caption: img.caption || null,
      sortOrder: idx,
    }))
  );

  // 시안을 처음 저장하면(= 아직 "시안 작성중" 단계에 도달하지 않았으면) 단계를 전환한다.
  await advanceProjectStage(projectId, "draft_wip", session.userId);

  return { revision: nextRevision };
}

export async function confirmDraftRevision(projectId: string, draftId: string): Promise<void> {
  const session = await requireSession();

  const [draft] = await db
    .select({ id: drafts.id, projectId: drafts.projectId })
    .from(drafts)
    .where(and(eq(drafts.id, draftId), eq(drafts.projectId, projectId)))
    .limit(1);
  if (!draft) throw new Error("시안 리비전을 찾을 수 없습니다.");

  // 프로젝트당 확정 리비전은 최대 1개만 유지.
  await db
    .update(drafts)
    .set({ isConfirmed: false, confirmedAt: null, confirmedBy: null })
    .where(and(eq(drafts.projectId, projectId), eq(drafts.isConfirmed, true)));

  await db
    .update(drafts)
    .set({ isConfirmed: true, confirmedAt: new Date(), confirmedBy: session.userId })
    .where(eq(drafts.id, draftId));

  await advanceProjectStage(projectId, "draft_confirmed", session.userId);
}

export async function listDraftNotifications(projectId: string): Promise<NotificationLogSummary[]> {
  await requireSession();

  const rows = await db
    .select()
    .from(notificationLog)
    .where(and(eq(notificationLog.projectId, projectId), eq(notificationLog.type, DRAFT_SENT_TYPE)))
    .orderBy(desc(notificationLog.createdAt));

  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    type: r.type,
    messageContent: r.messageContent,
    status: r.status,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

// 실제 카카오/문자/이메일 발송 연동은 아직 없다 — production의 배송일정안내와 같은 패턴으로,
// "고객에게 보냈다"는 이력만 notification_log에 남긴다(재발송 시 매번 새 행 추가, 멱등 처리 없음).
export async function sendDraftToCustomer(projectId: string, draftId: string): Promise<void> {
  await requireSession();

  const [draft] = await db
    .select({ id: drafts.id, revision: drafts.revision })
    .from(drafts)
    .where(and(eq(drafts.id, draftId), eq(drafts.projectId, projectId)))
    .limit(1);
  if (!draft) throw new Error("시안 리비전을 찾을 수 없습니다.");

  const [project] = await db
    .select({ projectNumber: projects.projectNumber, customerId: projects.customerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");

  const [customer] = await db
    .select({ companyName: customers.companyName })
    .from(customers)
    .where(eq(customers.id, project.customerId))
    .limit(1);

  const messageContent = `[${customer?.companyName ?? "고객"}] ${project.projectNumber} 인쇄 시안(Rev.${String(
    draft.revision
  ).padStart(2, "0")})이 발송되었습니다. 시안 주의사항을 함께 확인 후 확정 여부를 회신해 주세요.`;

  await db.insert(notificationLog).values({
    customerId: project.customerId,
    projectId,
    channel: "internal",
    type: DRAFT_SENT_TYPE,
    messageContent,
    status: "pending", // 실제 발송 연동 전 — 이력 생성까지만
  });
}

// 페이지를 열었을 때 기본으로 보여줄 견적 — 이 프로젝트에서 가장 최근에 저장한 시안
// 리비전이 연결해둔 견적을 그대로 보여준다(그 리비전을 만들 때 실제로 "불러오기"했던
// 견적이므로). 시안이 아직 하나도 없으면 아무것도 자동으로 고르지 않고, 사용자가
// 직접 "저장된 견적 찾기"에서 불러와야 한다.
// 이 프로젝트에서 가장 최근에 저장된 견적(같은 견적번호는 최신 리비전만 본 뒤, 그 중에서도
// created_at이 가장 늦은 견적번호)을 기본으로 보여준다. 예전엔 "가장 최근 시안이 연결해둔
// 견적"만 봤는데, 그러면 시안을 아직 한 번도 안 만든 새 견적서는 저장해도 시안 화면에
// 자동으로 뜨지 않았다(2026-09-11 피드백: "견적서만 작성하여 저장하면 자동으로 보이게
// 해줘") — 발주서/거래명세서의 getInitial*QuoteReference는 아직 이 방식으로 바꾸지 않았다.
export async function getInitialQuoteReference(projectId: string): Promise<QuoteReferenceSummary | null> {
  await requireSession();

  const rows = await db
    .select({ id: quotes.id, quoteNumber: quotes.quoteNumber, revision: quotes.revision, createdAt: quotes.createdAt })
    .from(quotes)
    .where(eq(quotes.projectId, projectId));

  if (rows.length === 0) return null;

  const latestByNumber = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const existing = latestByNumber.get(r.quoteNumber);
    if (!existing || r.revision > existing.revision) latestByNumber.set(r.quoteNumber, r);
  }
  const latest = Array.from(latestByNumber.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  return getQuoteReferenceById(latest.id);
}
