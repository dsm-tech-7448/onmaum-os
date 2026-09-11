"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DraftImageDraft,
  DraftRevisionSummary,
  NotificationLogSummary,
  QuoteReferenceSummary,
  QuoteSearchResult,
} from "@/lib/drafts/types";
import {
  saveDraft,
  confirmDraftRevision,
  listDraftRevisions,
  sendDraftToCustomer,
  listDraftNotifications,
  searchQuotesForDraftLink,
  getQuoteReferenceByNumber,
} from "./actions";
import { fmt } from "@/lib/quotes/korean-amount";

let uidCounter = 0;
function newUid() {
  uidCounter += 1;
  return `img-${Date.now()}-${uidCounter}`;
}

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function DraftEditor({
  projectId,
  initialRevisions,
  initialNotifications,
  initialQuoteReference,
}: {
  projectId: string;
  initialRevisions: DraftRevisionSummary[];
  initialNotifications: NotificationLogSummary[];
  initialQuoteReference: QuoteReferenceSummary | null;
}) {
  const router = useRouter();
  const [revisions, setRevisions] = useState<DraftRevisionSummary[]>(initialRevisions);
  const [notifications, setNotifications] = useState<NotificationLogSummary[]>(initialNotifications);
  const [note, setNote] = useState("");
  const [images, setImages] = useState<DraftImageDraft[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveHint, setSaveHint] = useState("");
  const [saveError, setSaveError] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  // 이 시안이 어느 견적서에 대한 것인지 — 명시적으로 "불러오기"해야 선택된다.
  const [selectedQuote, setSelectedQuote] = useState<QuoteReferenceSummary | null>(initialQuoteReference);
  const [showQuotePicker, setShowQuotePicker] = useState(!initialQuoteReference);
  const [quoteSearchQuery, setQuoteSearchQuery] = useState("");
  const [quoteSearchResults, setQuoteSearchResults] = useState<QuoteSearchResult[]>([]);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const debouncedQuoteSearch = useDebounced(quoteSearchQuery, 250);

  useEffect(() => {
    let cancelled = false;
    searchQuotesForDraftLink(projectId, debouncedQuoteSearch).then((r) => {
      if (!cancelled) setQuoteSearchResults(r);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, debouncedQuoteSearch]);

  async function handleSelectQuote(quoteNumber: string) {
    setIsLoadingQuote(true);
    try {
      const ref = await getQuoteReferenceByNumber(projectId, quoteNumber);
      setSelectedQuote(ref);
      setShowQuotePicker(false);
    } finally {
      setIsLoadingQuote(false);
    }
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    Array.from(fileList).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setImages((prev) => [
          ...prev,
          { uid: newUid(), imageDataUrl: reader.result as string, caption: "" },
        ]);
      };
      reader.readAsDataURL(file);
    });
  }

  function updateCaption(uid: string, caption: string) {
    setImages((prev) => prev.map((img) => (img.uid === uid ? { ...img, caption } : img)));
  }

  function removeImage(uid: string) {
    setImages((prev) => prev.filter((img) => img.uid !== uid));
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError("");
    try {
      const result = await saveDraft(projectId, note, images, selectedQuote?.id ?? null);
      setSaveHint(`저장됨: Rev.${String(result.revision).padStart(2, "0")} — 이미지 ${images.length}장`);
      setNote("");
      setImages([]);
      setRevisions(await listDraftRevisions(projectId));
      router.refresh(); // 프로젝트 헤더의 단계 표시/목록 페이지 색상을 최신 상태로
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirm(draftId: string) {
    setConfirmingId(draftId);
    try {
      await confirmDraftRevision(projectId, draftId);
      setRevisions(await listDraftRevisions(projectId));
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "확정에 실패했습니다.");
    } finally {
      setConfirmingId(null);
    }
  }

  // 견적 참고 정보에서 상품명을 뽑아온다 — 품목 줄이 있으면 그 이름, compare 모드면
  // compareProductName, 견적이 아직 없으면 "상품"으로 대체.
  const productNameForFile =
    selectedQuote?.items.find((it) => it.lineType === "product")?.name ||
    selectedQuote?.compareProductName ||
    "상품";

  function safeFileToken(s: string) {
    return s.replace(/[\\/:*?"<>|]/g, "").trim();
  }

  // "리비전 이력"은 이 프로젝트의 모든 시안(drafts.revision은 견적 상관없이 프로젝트
  // 전체에서 순번이 매겨짐 — schema.ts 참고)이 아니라, 지금 선택된 견적서에 대한 시안만
  // 보여준다(2026-09-11 피드백: 한 프로젝트에서 서로 다른 견적/상품의 시안을 여러 건
  // 진행할 때, 관련 없는 다른 견적의 시안이 같은 리비전 이력처럼 섞여 보이던 문제).
  const visibleRevisions = selectedQuote
    ? revisions.filter((r) => r.quoteNumber === selectedQuote.quoteNumber)
    : [];

  function downloadImage(dataUrl: string, revisionNo: number, index: number, total: number) {
    const customerLabel = safeFileToken(selectedQuote?.customerName || "고객사");
    const productLabel = safeFileToken(productNameForFile);
    const revLabel = `Rev${String(revisionNo).padStart(2, "0")}`;
    const suffix = total > 1 ? `_${index + 1}` : "";
    const ext = dataUrl.slice(dataUrl.indexOf("/") + 1, dataUrl.indexOf(";")) || "png";
    const filename = `시안-${customerLabel}_${productLabel}_${revLabel}${suffix}.${ext}`;

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleSend(draftId: string) {
    setSendingId(draftId);
    try {
      await sendDraftToCustomer(projectId, draftId);
      setNotifications(await listDraftNotifications(projectId));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "발송에 실패했습니다.");
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div className="flex items-start gap-6">
      <div className="w-[420px] shrink-0 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-neutral-900">시안 작성</h2>
        <p className="mb-4 text-xs text-neutral-500">
          이미지를 올리고 저장하면 새 리비전으로 쌓입니다. 고객이 최종 확정한 리비전에서
          &ldquo;이 리비전으로 확정&rdquo;을 누르면 프로젝트가 &ldquo;고객 시안 확정&rdquo; 단계로 넘어갑니다.
        </p>

        <div className="mb-4 rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3">
          <label className="mb-1 block text-xs font-medium text-neutral-700">
            어느 견적서에 대한 시안인가요?
          </label>
          {selectedQuote && !showQuotePicker ? (
            <div className="flex items-center justify-between rounded-md bg-white px-2.5 py-2 text-xs">
              <span>
                <span className="mr-1 font-bold text-[#8E1F3B]">{selectedQuote.quoteNumber}</span>
                {selectedQuote.customerName || "고객사 미입력"} · {productNameForFile}
              </span>
              <button
                type="button"
                onClick={() => setShowQuotePicker(true)}
                className="text-[11px] text-neutral-500 underline"
              >
                변경
              </button>
            </div>
          ) : (
            <>
              <input
                className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                placeholder="고객사명 또는 견적번호로 검색"
                value={quoteSearchQuery}
                onChange={(e) => setQuoteSearchQuery(e.target.value)}
              />
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {quoteSearchResults.length === 0 && (
                  <p className="text-[11px] text-neutral-400">저장된 견적이 없습니다.</p>
                )}
                {quoteSearchResults.map((q) => (
                  <div
                    key={q.quoteNumber}
                    className="flex items-center justify-between rounded-md bg-white px-2.5 py-1.5 text-[11px]"
                  >
                    <span>
                      <span className="mr-1.5 font-bold text-[#8E1F3B]">{q.quoteNumber}</span>
                      {q.customerName || "고객사 미입력"} · {q.productName || "품명 미입력"} · 품목 {q.itemCount}개
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSelectQuote(q.quoteNumber)}
                      disabled={isLoadingQuote}
                      className="rounded bg-[#8E1F3B] px-2 py-0.5 text-white disabled:opacity-50"
                    >
                      불러오기
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <label className="mb-1 block text-xs font-medium text-neutral-700">시안 이미지</label>
        <label className="mb-3 flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 hover:border-[#8E1F3B] hover:text-[#8E1F3B]">
          📷 시안 이미지 추가
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />
        </label>

        {images.length > 0 && (
          <div className="mb-3 flex flex-col gap-2">
            {images.map((img) => (
              <div key={img.uid} className="flex items-center gap-2 rounded-md border border-neutral-200 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.imageDataUrl} alt="" className="h-14 w-14 rounded object-cover" />
                <input
                  className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
                  placeholder="설명 (예: 정면, 컬러 옵션 A)"
                  value={img.caption}
                  onChange={(e) => updateCaption(img.uid, e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => removeImage(img.uid)}
                  className="rounded border border-neutral-300 px-2 py-1 text-xs text-red-600"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <label className="mb-1 block text-xs font-medium text-neutral-700">메모</label>
        <textarea
          rows={3}
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-xs"
          placeholder="예: 1차 시안 - 로고 사이즈 조정 필요"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || images.length === 0 || !selectedQuote}
          className="w-full rounded-md bg-[#2f7a4a] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {isSaving ? "저장 중..." : "💾 이 시안 저장 (새 리비전으로 기록)"}
        </button>
        {!selectedQuote && (
          <p className="mt-1 text-[11px] text-red-600">먼저 위에서 견적서를 불러와야 저장할 수 있습니다.</p>
        )}
        {saveHint && <p className="mt-1 text-[11px] text-neutral-500">{saveHint}</p>}
        {saveError && <p className="mt-1 text-[11px] text-red-600">{saveError}</p>}

        <div className="mt-5 border-t border-neutral-200 pt-4">
          <h3 className="mb-2 text-xs font-semibold text-neutral-900">시안 주의사항 (고객 발송용)</h3>
          <p className="mb-2 text-[11px] text-neutral-500">
            &ldquo;고객에게 발송&rdquo; 시 이 안내문도 함께 전달해주세요.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/branding/draft-notice.png"
            alt="시안 주의사항"
            className="w-full rounded-md border border-neutral-200"
          />
        </div>
      </div>

      <div className="flex-1">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">견적 내용 (참고)</h2>
        {selectedQuote ? (
          <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold text-[#8E1F3B]">
                {selectedQuote.quoteNumber}{" "}
                <span className="font-normal text-neutral-400">
                  (Rev.{String(selectedQuote.revision).padStart(2, "0")})
                </span>
              </span>
              <span className="text-xs text-neutral-500">
                {selectedQuote.customerName || "고객사 미입력"} · {selectedQuote.quoteDate}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {selectedQuote.items.map((it, idx) => (
                <div key={idx} className="flex items-center gap-2 rounded-md bg-neutral-50 px-2.5 py-1.5 text-xs">
                  {it.imageDataUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.imageDataUrl}
                      alt={it.name}
                      className="h-8 w-8 shrink-0 rounded border border-neutral-200 object-cover"
                    />
                  )}
                  <span className="flex-1">
                    <span
                      className={`mr-1 rounded px-1 py-0.5 text-[9px] font-medium ${
                        it.lineType === "product" ? "bg-[#8E1F3B] text-white" : "bg-neutral-200 text-neutral-600"
                      }`}
                    >
                      {it.lineType === "product" ? "품목" : "옵션"}
                    </span>
                    {it.name}
                    {it.spec && <span className="text-neutral-400"> · {it.spec}</span>}
                  </span>
                  <span className="shrink-0 text-neutral-500">
                    {it.qty ? `${Number(it.qty).toLocaleString()}${it.unit}` : ""}
                    {it.price ? ` · ${fmt(Number(it.price))}원` : ""}
                  </span>
                </div>
              ))}
              {selectedQuote.items.length === 0 && (
                <p className="text-[11px] text-neutral-400">품목이 입력되지 않은 견적입니다.</p>
              )}
            </div>
            <div className="mt-2.5 flex items-center justify-between border-t border-neutral-100 pt-2 text-xs">
              <span className="text-neutral-500">합계금액 (VAT 포함)</span>
              <span className="font-bold text-[#8E1F3B]">{fmt(selectedQuote.total)}원</span>
            </div>
          </div>
        ) : (
          <p className="mb-6 text-sm text-neutral-400">
            왼쪽에서 견적서를 먼저 불러오세요 — 어느 견적에 대한 시안인지 알아야 확인할 수 있습니다.
          </p>
        )}

        <h2 className="mb-3 text-sm font-semibold text-neutral-900">리비전 이력</h2>
        {visibleRevisions.length === 0 ? (
          <p className="text-sm text-neutral-400">
            {selectedQuote ? "이 견적서에 대해 아직 저장된 시안이 없습니다." : "아직 저장된 시안이 없습니다."}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {visibleRevisions.map((rev) => (
              <div
                key={rev.id}
                className={`rounded-xl border p-4 ${
                  rev.isConfirmed ? "border-[#8E1F3B] bg-[#fdf7f9]" : "border-neutral-200 bg-white"
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-bold text-[#8E1F3B]">Rev.{String(rev.revision).padStart(2, "0")}</span>
                    <span className="text-xs text-neutral-400">
                      {new Date(rev.createdAt).toLocaleString("ko-KR", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {rev.isConfirmed && (
                      <span className="rounded-full bg-[#8E1F3B] px-2 py-0.5 text-[11px] font-medium text-white">
                        확정됨
                      </span>
                    )}
                    {rev.quoteNumber && (
                      <span className="text-[11px] text-neutral-400">· {rev.quoteNumber}</span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSend(rev.id)}
                      disabled={sendingId === rev.id}
                      className="rounded-md border border-[#8E1F3B] px-3 py-1 text-xs font-medium text-[#8E1F3B] disabled:opacity-50"
                    >
                      {sendingId === rev.id ? "발송 중..." : "📤 고객에게 발송"}
                    </button>
                    {!rev.isConfirmed && (
                      <button
                        type="button"
                        onClick={() => handleConfirm(rev.id)}
                        disabled={confirmingId === rev.id}
                        className="rounded-md bg-[#8E1F3B] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {confirmingId === rev.id ? "확정 중..." : "이 리비전으로 확정"}
                      </button>
                    )}
                  </div>
                </div>
                {rev.note && <p className="mb-2 text-xs text-neutral-600">{rev.note}</p>}
                <div className="flex flex-wrap gap-2">
                  {rev.images.map((img, idx) => (
                    <div key={img.id} className="text-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.imageDataUrl}
                        alt={img.caption}
                        className="h-24 w-24 rounded-md border border-neutral-200 object-cover"
                      />
                      {img.caption && <p className="mt-1 w-24 truncate text-[10px] text-neutral-500">{img.caption}</p>}
                      <button
                        type="button"
                        onClick={() => downloadImage(img.imageDataUrl, rev.revision, idx, rev.images.length)}
                        className="mt-1 w-24 rounded border border-neutral-300 py-0.5 text-[10px] text-neutral-600 hover:border-[#8E1F3B] hover:text-[#8E1F3B]"
                      >
                        ⬇ 파일로 저장
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <h2 className="mb-3 mt-6 text-sm font-semibold text-neutral-900">발송 이력</h2>
        {notifications.length === 0 ? (
          <p className="text-sm text-neutral-400">아직 고객에게 발송한 이력이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {notifications.map((n) => (
              <div key={n.id} className="rounded-xl border border-neutral-200 bg-white p-3 text-sm">
                <div className="mb-1 text-[11px] text-neutral-400">
                  {new Date(n.createdAt).toLocaleString("ko-KR", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                <p className="text-xs text-neutral-600">{n.messageContent}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
