export type DraftImageDraft = {
  uid: string; // 클라이언트 전용 임시 id (React key / 순서용, 저장 안 됨)
  imageDataUrl: string;
  caption: string;
};

export type DraftRevisionSummary = {
  id: string;
  revision: number;
  note: string;
  isConfirmed: boolean;
  confirmedAt: string | null;
  createdAt: string;
  images: { id: string; imageDataUrl: string; caption: string }[];
  quoteNumber: string | null; // 저장 당시 "불러오기"로 연결한 견적번호 (없으면 미연결)
};

export type { NotificationLogSummary } from "@/lib/notifications/types";
export type { QuoteSearchResult, QuoteReferenceSummary } from "@/lib/quotes/types";
