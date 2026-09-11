"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { QuoteDraft, QuoteMode, QuoteRevisionSummary, QuoteSearchResult } from "@/lib/quotes/types";
import { QuotePreview, type CompanyFooterInfo } from "@/components/quote/quote-preview";
import { blankItem } from "@/components/quote/item-rows-editor";
import { QuoteItemRowsEditor } from "@/components/quote/quote-item-rows-editor";
import { TierEditor, newTier } from "@/components/quote/tier-editor";
import {
  generateNewQuoteNumber,
  getQuoteRevisions,
  loadQuoteRevision,
  saveQuote,
  searchProjectQuotes,
} from "./actions";

const MODES: { value: QuoteMode; label: string }[] = [
  { value: "single", label: "단일 상품" },
  { value: "multiple", label: "복수 품목" },
  { value: "compare", label: "비교 견적" },
];

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function QuoteEditor({
  projectId,
  initialDraft,
  initialQuoteList,
  optionNames,
  productNames,
  logo,
  seal,
  company,
}: {
  projectId: string;
  initialDraft: QuoteDraft;
  initialQuoteList: QuoteSearchResult[];
  optionNames: string[];
  productNames: string[];
  logo: string;
  seal: string;
  company: CompanyFooterInfo;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<QuoteDraft>(initialDraft);
  const [revision, setRevision] = useState(0); // 0 = 아직 저장된 적 없음
  const [revisions, setRevisions] = useState<QuoteRevisionSummary[]>([]);
  const [saveHint, setSaveHint] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [quoteList, setQuoteList] = useState<QuoteSearchResult[]>(initialQuoteList);
  const debouncedSearch = useDebounced(searchQuery, 250);
  const debouncedQuoteNumber = useDebounced(draft.quoteNumber, 300);

  const previewRef = useRef<HTMLDivElement>(null);
  const nameListId = "quote-name-suggestions";

  useEffect(() => {
    let cancelled = false;
    getQuoteRevisions(projectId, debouncedQuoteNumber).then((r) => {
      if (!cancelled) setRevisions(r);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, debouncedQuoteNumber]);

  useEffect(() => {
    let cancelled = false;
    searchProjectQuotes(projectId, debouncedSearch).then((r) => {
      if (!cancelled) setQuoteList(r);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, debouncedSearch]);

  function set<K extends keyof QuoteDraft>(key: K, value: QuoteDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function handleModeChange(mode: QuoteMode) {
    setDraft((d) => {
      if (mode === "compare" && d.tiers.length === 0) {
        return { ...d, mode, tiers: [newTier()] };
      }
      return { ...d, mode };
    });
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError("");
    try {
      const result = await saveQuote(projectId, draft);
      setRevision(result.revision);
      setSaveHint(
        `저장됨: ${draft.quoteNumber} Rev.${String(result.revision).padStart(2, "0")} (${
          draft.customerName || "고객사 미입력"
        }) — 총 ${
          draft.mode === "compare"
            ? draft.tiers.reduce((n, t) => n + t.items.length, 0)
            : draft.items.length
        }개 품목`
      );
      const [revs, list] = await Promise.all([
        getQuoteRevisions(projectId, draft.quoteNumber),
        searchProjectQuotes(projectId, searchQuery),
      ]);
      setRevisions(revs);
      setQuoteList(list);
      router.refresh(); // 프로젝트 헤더의 단계 표시/목록 페이지 색상을 최신 상태로
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLoadRevision(quoteNumber: string, rev: number) {
    const result = await loadQuoteRevision(projectId, quoteNumber, rev);
    if (!result) return;
    setDraft(result);
    setRevision(rev);
    setSaveHint("");
    setSaveError("");
  }

  async function handleNewQuote() {
    const quoteNumber = await generateNewQuoteNumber();
    setDraft((d) => ({
      quoteNumber,
      mode: d.mode, // 작업 중이던 모드(단일/복수/비교)는 그대로 유지 — 번호만 새로 받는 버튼이라서
      customerName: d.customerName,
      contactName: d.contactName,
      contactPhone: d.contactPhone,
      quoteDate: new Date().toISOString().slice(0, 10),
      validity: "견적 후 7일",
      confirmText:
        "・출고일 : 발주 후 5일\n・결제조건 : 세금계산서 발행 후 7일 이내\n・상기 견적은 부가세(VAT) 포함 금액입니다.",
      mainImageDataUrl: null,
      compareProductCode: "",
      compareProductName: "",
      compareProductSpec: "",
      adjustmentLabel: "절삭",
      adjustmentAmount: "",
      items: d.mode === "compare" ? [] : [blankItem("product")],
      tiers: d.mode === "compare" ? [newTier()] : [],
    }));
    setRevision(0);
    setSaveHint("");
    setSaveError("");
  }

  async function handleExportPng() {
    const node = previewRef.current;
    if (!node) return;
    setIsExporting(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const scale = 2480 / node.offsetWidth;
      const canvas = await html2canvas(node, {
        scale,
        backgroundColor: "#ffffff",
        useCORS: true,
        windowWidth: node.offsetWidth,
      });
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      // 품목 줄(lineType='product')이 실제 상품명 — 옵션 줄(추가 비용 등)이 배열 순서상
      // 먼저 올 수도 있어서 items[0]에 기대지 않고 명시적으로 찾는다.
      const productItem = draft.items.find((it) => it.lineType === "product") ?? draft.items[0];
      const productName = draft.mode === "compare" ? draft.compareProductName : productItem?.name || "상품";
      const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "").trim();
      // 견적번호(QT-...)는 문서 식별용으로 그대로 두고, 다운로드 파일명만 한글로 바꿔
      // 보여준다(2026-09-10) — 견적번호 필드 자체는 QT- 접두사를 유지해달라는 피드백.
      const fileLabel = (draft.quoteNumber || "견적서").replace(/^QT-/, "견적서-");
      a.href = url;
      a.download = `${safe(fileLabel)}-${safe(draft.customerName || "고객사")}-${safe(
        productName || "상품"
      )}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    } finally {
      setIsExporting(false);
    }
  }

  const isNewQuote = revisions.length === 0;
  const nextRevisionNo = isNewQuote ? 1 : (revisions[0]?.revision ?? 0) + 1;

  return (
    <div className="flex items-start gap-6">
      <div className="w-[440px] shrink-0 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-neutral-900">견적서 작성</h2>
        <p className="mb-3 text-xs text-neutral-500">
          품목/옵션 줄을 자유롭게 추가하고, 저장하면 같은 견적번호에 새 리비전으로 쌓입니다.
        </p>
        <div
          className={`mb-4 rounded-md px-3 py-2 text-xs font-medium ${
            isNewQuote ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {isNewQuote
            ? "🆕 신규 견적 작성 중 — 저장하면 Rev.01로 처음 생성됩니다."
            : `📝 기존 견적 리비전 작성 중 — 저장하면 Rev.${String(nextRevisionNo).padStart(2, "0")}로 추가됩니다.`}
        </div>

        <div className="mb-3 flex gap-1 rounded-md bg-neutral-100 p-1">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => handleModeChange(m.value)}
              className={`flex-1 rounded px-2 py-1.5 text-xs ${
                draft.mode === m.value ? "bg-[#8E1F3B] font-bold text-white" : "text-neutral-600"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {draft.mode === "compare" && (
          <p className="mb-3 text-[11px] text-neutral-500">
            같은 상품을 수량 구간별로 비교할 때 사용합니다. 상품 정보는 한 번만 입력하고, 수량·단가만
            구간별로 추가하세요.
          </p>
        )}

        <label className="mb-1 block text-xs font-medium text-neutral-700">고객사명 (선택)</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.customerName}
          onChange={(e) => set("customerName", e.target.value)}
          placeholder="견적 요청 시 미확보된 경우 비워둘 수 있습니다"
        />

        <label className="mb-1 block text-xs font-medium text-neutral-700">담당자 (선택)</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.contactName}
          onChange={(e) => set("contactName", e.target.value)}
          placeholder="담당자가 자주 바뀌거나 여러 명일 수 있어 매번 입력합니다"
        />

        <label className="mb-1 block text-xs font-medium text-neutral-700">담당자 전화번호 (선택, 내부 관리용)</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.contactPhone}
          onChange={(e) => set("contactPhone", e.target.value)}
          placeholder="고객에게 제출되는 견적서에는 표시되지 않습니다"
        />

        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs font-medium text-neutral-700">견적번호</label>
          <button type="button" onClick={handleNewQuote} className="text-[11px] text-neutral-500 underline">
            새 견적번호로 시작
          </button>
        </div>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.quoteNumber}
          onChange={(e) => set("quoteNumber", e.target.value)}
        />

        <div className="mb-3 flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-700">견적일자</label>
            <input
              type="date"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              value={draft.quoteDate}
              onChange={(e) => set("quoteDate", e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-700">유효기간</label>
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              value={draft.validity}
              onChange={(e) => set("validity", e.target.value)}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !draft.quoteNumber.trim()}
          className={`mb-1 w-full rounded-md px-3 py-2 text-sm font-bold text-white disabled:opacity-50 ${
            isNewQuote ? "bg-[#2f7a4a]" : "bg-[#b8720a]"
          }`}
        >
          {isSaving
            ? "저장 중..."
            : isNewQuote
              ? "💾 신규 견적 저장"
              : `💾 새 리비전으로 저장 (Rev.${String(nextRevisionNo).padStart(2, "0")})`}
        </button>
        {saveHint && <p className="text-[11px] text-neutral-500">{saveHint}</p>}
        {saveError && <p className="text-[11px] text-red-600">{saveError}</p>}

        {revisions.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-700">리비전 이력 (같은 견적번호)</label>
            {revisions.map((r) => (
              <div
                key={r.revision}
                className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-[11px] ${
                  r.revision === revision ? "bg-[#f6dee4]" : "bg-neutral-100"
                }`}
              >
                <span>
                  <span className="mr-1.5 font-bold text-[#8E1F3B]">
                    Rev.{String(r.revision).padStart(2, "0")}
                  </span>
                  {new Date(r.createdAt).toLocaleString("ko-KR", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {r.productName || "품명 미입력"} · 품목 {r.itemCount}개
                </span>
                <button
                  type="button"
                  onClick={() => handleLoadRevision(draft.quoteNumber, r.revision)}
                  className="rounded bg-[#8E1F3B] px-2 py-0.5 text-white"
                >
                  불러오기
                </button>
              </div>
            ))}
          </div>
        )}

        <h3 className="mb-2 mt-5 border-b border-neutral-100 pb-1 text-[13px] font-semibold text-[#8E1F3B]">
          저장된 견적 찾기 (이 프로젝트)
        </h3>
        <input
          className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          placeholder="고객사명 · 견적번호 · 상품명으로 검색"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {quoteList.length === 0 && <p className="text-[11px] text-neutral-400">저장된 견적이 없습니다.</p>}
          {quoteList.map((q) => (
            <div
              key={q.quoteNumber}
              className="flex items-center justify-between rounded-md bg-neutral-100 px-2.5 py-1.5 text-[11px]"
            >
              <span>
                <span className="mr-1.5 font-bold text-[#8E1F3B]">{q.quoteNumber}</span>
                {q.customerName || "고객사 미입력"} · {q.productName || "품명 미입력"} · Rev.
                {String(q.latestRevision).padStart(2, "0")} · 품목 {q.itemCount}개
              </span>
              <button
                type="button"
                onClick={() => handleLoadRevision(q.quoteNumber, q.latestRevision)}
                className="rounded bg-[#8E1F3B] px-2 py-0.5 text-white"
              >
                불러오기
              </button>
            </div>
          ))}
        </div>

        {draft.mode === "compare" ? (
          <>
            <h3 className="mb-2 mt-5 border-b border-neutral-100 pb-1 text-[13px] font-semibold text-[#8E1F3B]">
              상품 정보 (구간 공통)
            </h3>
            <label className="mb-1 block text-xs font-medium text-neutral-700">상품코드</label>
            <input
              className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              value={draft.compareProductCode}
              onChange={(e) => set("compareProductCode", e.target.value)}
            />
            <label className="mb-1 block text-xs font-medium text-neutral-700">품목명</label>
            <input
              className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              value={draft.compareProductName}
              onChange={(e) => set("compareProductName", e.target.value)}
            />
            <label className="mb-1 block text-xs font-medium text-neutral-700">규격/사양</label>
            <input
              className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              placeholder="예: 유포지 250u / 양면 컬러"
              value={draft.compareProductSpec}
              onChange={(e) => set("compareProductSpec", e.target.value)}
            />

            <h3 className="mb-2 mt-4 border-b border-neutral-100 pb-1 text-[13px] font-semibold text-[#8E1F3B]">
              수량 구간
            </h3>
            <TierEditor
              tiers={draft.tiers}
              onChange={(tiers) => set("tiers", tiers)}
              productNames={productNames}
              optionNames={optionNames}
              listId={nameListId}
            />
          </>
        ) : (
          <>
            <h3 className="mb-2 mt-5 border-b border-neutral-100 pb-1 text-[13px] font-semibold text-[#8E1F3B]">
              품목
            </h3>
            <QuoteItemRowsEditor
              items={draft.items}
              onChange={(items) => set("items", items)}
              productNames={productNames}
              optionNames={optionNames}
              listId={nameListId}
            />
          </>
        )}

        <h3 className="mb-2 mt-4 border-b border-neutral-100 pb-1 text-[13px] font-semibold text-[#8E1F3B]">
          절삭 (선택)
        </h3>
        <p className="mb-2 text-[11px] text-neutral-400">
          견적 총액을 특정 금액(예: 육백만원 정)에 맞추기 위해 최종 합계를 조정할 때만 입력하세요 — 품목 계산과는 별개로
          합계에 그대로 더해집니다(음수 가능).
        </p>
        <div className="mb-4 flex gap-2">
          <input
            className="w-24 rounded-md border border-neutral-300 px-3 py-2 text-sm"
            value={draft.adjustmentLabel}
            onChange={(e) => set("adjustmentLabel", e.target.value)}
          />
          <input
            type="number"
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
            placeholder="예: -390"
            value={draft.adjustmentAmount}
            onChange={(e) => set("adjustmentAmount", e.target.value)}
          />
        </div>

        {/* 견적서 전체에 공통으로 붙는 이미지 업로드 입력은 없앴습니다 — 품목별 이미지(위 각
            품목 줄의 "이미지 추가")로 대체됐고, 이 공통 칸은 한 번 넣으면 지울 방법이 없어서
            실수로 잘못 넣으면 되돌릴 수 없었습니다. 예전에 저장된 견적에 이미 들어있는
            값이라면 여기서 확인하고 제거만 할 수 있게 남겨둡니다. */}
        {draft.mainImageDataUrl && (
          <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium text-neutral-700">
                공통 이미지 (예전 견적에 저장된 값 — 이제 품목별 이미지 사용을 권장합니다)
              </label>
              <button
                type="button"
                onClick={() => set("mainImageDataUrl", null)}
                className="text-[11px] text-red-600 underline"
              >
                이미지 제거
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={draft.mainImageDataUrl}
              alt="상품 이미지 미리보기"
              className="h-[100px] w-auto shrink-0 rounded border border-neutral-300"
            />
          </div>
        )}

        <h3 className="mb-2 mt-4 border-b border-neutral-100 pb-1 text-[13px] font-semibold text-[#8E1F3B]">
          확인사항 (견적서용)
        </h3>
        <textarea
          rows={4}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-xs"
          value={draft.confirmText}
          onChange={(e) => set("confirmText", e.target.value)}
        />

        <button
          type="button"
          onClick={handleExportPng}
          disabled={isExporting}
          className="mt-4 w-full rounded-md bg-[#8E1F3B] px-3 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {isExporting ? "이미지 생성 중..." : "이미지로 저장 (PNG, A4)"}
        </button>
      </div>

      <div className="flex flex-1 justify-center">
        <div ref={previewRef}>
          <QuotePreview draft={draft} revision={revision || 1} logo={logo} seal={seal} company={company} />
        </div>
      </div>
    </div>
  );
}
