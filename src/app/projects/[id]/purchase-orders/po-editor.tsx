"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PoDraft, PoRevisionSummary, PoSearchResult } from "@/lib/purchase-orders/types";
import type { QuoteReferenceSummary, QuoteSearchResult } from "@/lib/quotes/types";
import { PoPreview } from "@/components/po/po-preview";
import type { CompanyFooterInfo } from "@/components/quote/quote-preview";
import { SupplierSearch } from "@/components/po/supplier-search";
import { ItemRowsEditor, blankItem, newUid } from "@/components/quote/item-rows-editor";
import {
  generateNewPoNumber,
  getPoRevisions,
  getQuoteReferenceById,
  getQuoteReferenceByNumber,
  loadPoRevision,
  recordSupplierPayment,
  savePO,
  searchProjectPOs,
  searchQuotesForPoLink,
  updateReqDate,
} from "./actions";

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function PoEditor({
  projectId,
  initialDraft,
  initialPoList,
  initialQuoteReference,
  productNames,
  optionNames,
  logo,
  company,
}: {
  projectId: string;
  initialDraft: PoDraft;
  initialPoList: PoSearchResult[];
  initialQuoteReference: QuoteReferenceSummary | null;
  productNames: string[];
  optionNames: string[];
  logo: string;
  company: CompanyFooterInfo;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<PoDraft>(initialDraft);
  const [revision, setRevision] = useState(0);
  const [revisions, setRevisions] = useState<PoRevisionSummary[]>([]);
  const [saveHint, setSaveHint] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [paymentHint, setPaymentHint] = useState("");
  const [isSavingReqDate, setIsSavingReqDate] = useState(false);
  const [reqDateHint, setReqDateHint] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [poList, setPoList] = useState<PoSearchResult[]>(initialPoList);
  const debouncedSearch = useDebounced(searchQuery, 250);
  const debouncedPoNumber = useDebounced(draft.poNumber, 300);
  const nameListId = "po-name-suggestions";
  const previewRef = useRef<HTMLDivElement>(null);

  const [selectedQuote, setSelectedQuote] = useState<QuoteReferenceSummary | null>(initialQuoteReference);
  const [showQuotePicker, setShowQuotePicker] = useState(!initialQuoteReference);
  const [quoteSearchQuery, setQuoteSearchQuery] = useState("");
  const [quoteSearchResults, setQuoteSearchResults] = useState<QuoteSearchResult[]>([]);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const debouncedQuoteSearch = useDebounced(quoteSearchQuery, 250);
  const [showItemPicker, setShowItemPicker] = useState(!initialDraft.quoteItemId);
  const [checkedItemIds, setCheckedItemIds] = useState<Set<string>>(new Set());

  const pickedItemRows = draft.items.filter((it) => it.name.trim() !== "");

  function toggleCheckedItem(id: string) {
    setCheckedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleAddQuoteItems(items: NonNullable<typeof selectedQuote>["items"]) {
    if (items.length === 0) return;
    setDraft((d) => {
      const existing = d.items.filter((it) => it.name.trim() !== "");
      const added = items.map((item) => ({
        uid: newUid(),
        lineType: (item.lineType === "option" ? "option" : "product") as "product" | "option",
        code: "",
        name: item.name,
        spec: item.spec,
        unit: item.unit || "개",
        qty: item.qty,
        price: "",
      }));
      return {
        ...d,
        quoteItemId: d.quoteItemId ?? items[0].id,
        items: [...existing, ...added],
      };
    });
    setCheckedItemIds(new Set());
    setShowItemPicker(false);
  }

  useEffect(() => {
    let cancelled = false;
    searchQuotesForPoLink(projectId, debouncedQuoteSearch).then((r) => {
      if (!cancelled) setQuoteSearchResults(r);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, debouncedQuoteSearch]);

  async function handleSelectQuote(quoteNumber: string) {
    setIsLoadingQuote(true);
    try {
      const quote = await getQuoteReferenceByNumber(projectId, quoteNumber);
      if (quote) {
        setSelectedQuote(quote);
        setDraft((d) => ({ ...d, quoteId: quote.id, quoteItemId: null }));
        setShowQuotePicker(false);
        setShowItemPicker(true);
      }
    } finally {
      setIsLoadingQuote(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    getPoRevisions(projectId, debouncedPoNumber).then((r) => {
      if (!cancelled) setRevisions(r);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, debouncedPoNumber]);

  useEffect(() => {
    let cancelled = false;
    searchProjectPOs(projectId, debouncedSearch).then((r) => {
      if (!cancelled) setPoList(r);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, debouncedSearch]);

  function set<K extends keyof PoDraft>(key: K, value: PoDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleSaveReqDate() {
    if (!draft.id) return;
    setIsSavingReqDate(true);
    setReqDateHint("");
    try {
      await updateReqDate(projectId, draft.id, draft.reqDate);
      setReqDateHint("발송요청일이 수정되었습니다.");
      router.refresh();
    } finally {
      setIsSavingReqDate(false);
    }
  }

  async function handleSavePayment() {
    if (!draft.id) return;
    setIsSavingPayment(true);
    setPaymentHint("");
    try {
      await recordSupplierPayment(projectId, draft.id, draft.paidAmount, draft.paidDate);
      setPaymentHint("입금 기록이 저장되었습니다.");
      router.refresh();
    } finally {
      setIsSavingPayment(false);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError("");
    try {
      const result = await savePO(projectId, draft);
      setRevision(result.revision);
      setDraft((d) => ({ ...d, id: result.id }));
      setSaveHint(
        `저장됨: ${draft.poNumber} Rev.${String(result.revision).padStart(2, "0")} (${draft.supplierName}) — 총 ${draft.items.length}개 품목. 아래에서 바로 공급업체 입금을 기록할 수 있습니다.`
      );
      const [revs, list] = await Promise.all([
        getPoRevisions(projectId, draft.poNumber),
        searchProjectPOs(projectId, searchQuery),
      ]);
      setRevisions(revs);
      setPoList(list);
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLoadRevision(poNumber: string, rev: number) {
    const result = await loadPoRevision(projectId, poNumber, rev);
    if (!result) return;
    setDraft(result);
    setRevision(rev);
    setSaveHint("");
    setSaveError("");
    setPaymentHint("");
    setReqDateHint("");

    if (result.quoteId) {
      const quote = await getQuoteReferenceById(result.quoteId);
      setSelectedQuote(quote);
      setShowQuotePicker(!quote);
      setShowItemPicker(!result.quoteItemId);
    } else {
      setSelectedQuote(null);
      setShowQuotePicker(true);
      setShowItemPicker(true);
    }
  }

  async function handleNewPo() {
    const poNumber = await generateNewPoNumber();
    setDraft((d) => ({
      poNumber,
      quoteId: d.quoteId,
      quoteItemId: null,
      supplierId: null,
      supplierName: "",
      supplierPhone: "",
      receiver: "",
      poDate: new Date().toISOString().slice(0, 10),
      reqDate: "",
      payTerm: "현금",
      printNote: "없음",
      shipAddr: "",
      shipReceiver: "",
      note: "",
      requestNote: d.requestNote,
      paidAmount: "",
      paidDate: "",
      items: [blankItem("product")],
    }));
    setRevision(0);
    setSaveHint("");
    setSaveError("");
    setPaymentHint("");
    setReqDateHint("");
    setShowItemPicker(true);
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
      const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "").trim();
      const productShort = safe(draft.items[0]?.name || "품목").slice(0, 7);
      a.href = url;
      a.download = `발주서-${safe(draft.supplierName || "공급업체")}_${productShort}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex items-start gap-6">
      <div className="w-[440px] shrink-0 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-neutral-900">발주서 작성</h2>
        <p className="mb-4 text-xs text-neutral-500">
          품목마다 공급업체가 대부분 다르므로, 발주서는 품목 하나 단위로 작성하세요(한
          업체가 2~3개 품목을 함께 공급하면 아래 품목 줄을 추가하면 됩니다). 저장하면 같은
          발주번호에 새 리비전으로 쌓입니다.
        </p>

        <div className="mb-4 rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3">
          <label className="mb-1 block text-xs font-medium text-neutral-700">어느 견적서에 대한 발주인가요?</label>
          {selectedQuote && !showQuotePicker ? (
            <div className="rounded-md bg-white px-2.5 py-2 text-xs">
              <div className="flex items-center justify-between">
                <span>
                  <span className="mr-1 font-bold text-[#8E1F3B]">{selectedQuote.quoteNumber}</span>
                  {selectedQuote.customerName || "고객사 미입력"}
                </span>
                <button
                  type="button"
                  onClick={() => setShowQuotePicker(true)}
                  className="text-[11px] text-neutral-500 underline"
                >
                  변경
                </button>
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">
                견적 합계 {selectedQuote.total.toLocaleString()}원 · 품목 {selectedQuote.items.length}개
              </p>
            </div>
          ) : (
            <>
              <input
                className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-xs"
                placeholder="고객사명 또는 견적번호로 검색"
                value={quoteSearchQuery}
                onChange={(e) => setQuoteSearchQuery(e.target.value)}
              />
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
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

        {selectedQuote && !showQuotePicker && selectedQuote.items.length > 0 && (
          <div className="mb-4 rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3">
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs font-medium text-neutral-700">이 발주는 어느 품목에 대한 건가요?</label>
              {pickedItemRows.length > 0 && !showItemPicker && (
                <button
                  type="button"
                  onClick={() => setShowItemPicker(true)}
                  className="text-[11px] text-neutral-500 underline"
                >
                  품목 추가/변경
                </button>
              )}
            </div>
            {pickedItemRows.length > 0 && !showItemPicker ? (
              <div className="flex flex-col gap-1 rounded-md bg-white px-2.5 py-2 text-xs">
                {pickedItemRows.map((it) => (
                  <div key={it.uid}>
                    <span className="mr-1.5 font-bold text-[#8E1F3B]">{it.name}</span>
                    {it.spec} · {it.qty}
                    {it.unit || "개"}
                  </div>
                ))}
              </div>
            ) : (
              <>
                <p className="mb-1 text-[11px] text-neutral-500">
                  한 공급업체로 여러 품목을 같이 보낼 때는 체크박스로 여러 개를 선택한 뒤 아래
                  버튼을 눌러주세요.
                </p>
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {selectedQuote.items.map((it) => (
                    <label
                      key={it.id}
                      className="flex cursor-pointer items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-[11px]"
                    >
                      <input
                        type="checkbox"
                        checked={checkedItemIds.has(it.id)}
                        onChange={() => toggleCheckedItem(it.id)}
                      />
                      <span
                        className={`rounded px-1 text-[10px] text-white ${
                          it.lineType === "product" ? "bg-[#8E1F3B]" : "bg-neutral-400"
                        }`}
                      >
                        {it.lineType === "product" ? "품목" : "옵션"}
                      </span>
                      {it.name} · {it.qty}
                      {it.unit || "개"} · {Number(it.price || 0).toLocaleString()}원
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleAddQuoteItems(selectedQuote.items.filter((it) => checkedItemIds.has(it.id)))
                  }
                  disabled={checkedItemIds.size === 0}
                  className="mt-2 w-full rounded-md bg-[#8E1F3B] px-2 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
                >
                  선택한 품목으로 작성 ({checkedItemIds.size}개)
                </button>
              </>
            )}
          </div>
        )}

        <label className="mb-1 block text-xs font-medium text-neutral-700">공급자 (협력업체)</label>
        <SupplierSearch
          supplierId={draft.supplierId}
          supplierName={draft.supplierName}
          onChange={(v) =>
            setDraft((d) => ({
              ...d,
              supplierId: v.supplierId,
              supplierName: v.supplierName,
              ...(v.supplierPhone !== undefined ? { supplierPhone: v.supplierPhone } : {}),
            }))
          }
        />

        <div className="mb-3 mt-3 flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-700">협력업체 전화</label>
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              value={draft.supplierPhone}
              onChange={(e) => set("supplierPhone", e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-700">수신자</label>
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              value={draft.receiver}
              onChange={(e) => set("receiver", e.target.value)}
            />
          </div>
        </div>

        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs font-medium text-neutral-700">발주번호</label>
          <button type="button" onClick={handleNewPo} className="text-[11px] text-neutral-500 underline">
            새 발주번호로 시작
          </button>
        </div>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.poNumber}
          onChange={(e) => set("poNumber", e.target.value)}
        />

        <div className="mb-3 flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-700">발주일자</label>
            <input
              type="date"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              value={draft.poDate}
              onChange={(e) => set("poDate", e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-700">발송요청일</label>
            <input
              type="date"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              value={draft.reqDate}
              onChange={(e) => set("reqDate", e.target.value)}
            />
          </div>
        </div>
        {draft.id && (
          <div className="mb-3 -mt-1">
            <button
              type="button"
              onClick={handleSaveReqDate}
              disabled={isSavingReqDate}
              className="text-[11px] text-[#8E1F3B] underline disabled:opacity-50"
            >
              {isSavingReqDate ? "저장 중..." : "발송요청일만 수정 저장 (리비전 생성 없음)"}
            </button>
            {reqDateHint && <p className="mt-1 text-[11px] text-neutral-500">{reqDateHint}</p>}
          </div>
        )}

        <label className="mb-1 block text-xs font-medium text-neutral-700">지불조건</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.payTerm}
          onChange={(e) => set("payTerm", e.target.value)}
        />

        <label className="mb-1 block text-xs font-medium text-neutral-700">인쇄 확인</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          placeholder="예: 없음 / 첨부 확인 / 최종본"
          value={draft.printNote}
          onChange={(e) => set("printNote", e.target.value)}
        />

        <label className="mb-1 block text-xs font-medium text-neutral-700">배송 주소</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.shipAddr}
          onChange={(e) => set("shipAddr", e.target.value)}
        />

        <label className="mb-1 block text-xs font-medium text-neutral-700">수령자</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.shipReceiver}
          onChange={(e) => set("shipReceiver", e.target.value)}
        />

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !draft.supplierName.trim() || !draft.poNumber.trim() || !draft.quoteId}
          className="mb-1 w-full rounded-md bg-[#2f7a4a] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {isSaving ? "저장 중..." : "💾 이 발주 저장 (새 리비전으로 기록)"}
        </button>
        {!draft.quoteId && (
          <p className="mt-1 text-[11px] text-red-600">먼저 위에서 견적서를 불러와야 저장할 수 있습니다.</p>
        )}
        {saveHint && <p className="text-[11px] text-neutral-500">{saveHint}</p>}
        {saveError && <p className="rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-600">{saveError}</p>}

        {revisions.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-700">리비전 이력 (같은 발주번호)</label>
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
                  · 품목 {r.itemCount}개
                  {r.quoteNumber && <span className="text-neutral-400"> · {r.quoteNumber}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => handleLoadRevision(draft.poNumber, r.revision)}
                  className="rounded bg-[#8E1F3B] px-2 py-0.5 text-white"
                >
                  불러오기
                </button>
              </div>
            ))}
          </div>
        )}

        {draft.id && (
          <div className="mt-5 rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3">
            <label className="mb-1 block text-xs font-medium text-neutral-700">
              공급업체 입금 (참고용)
            </label>
            <div className="mb-2 flex gap-2">
              <input
                type="number"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                placeholder="입금액"
                value={draft.paidAmount}
                onChange={(e) => set("paidAmount", e.target.value)}
              />
              <input
                type="date"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                value={draft.paidDate}
                onChange={(e) => set("paidDate", e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={handleSavePayment}
              disabled={isSavingPayment}
              className="w-full rounded-md bg-neutral-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isSavingPayment ? "저장 중..." : "입금 기록 저장"}
            </button>
            {paymentHint && <p className="mt-1 text-[11px] text-neutral-500">{paymentHint}</p>}
          </div>
        )}

        <h3 className="mb-2 mt-5 border-b border-neutral-100 pb-1 text-[13px] font-semibold text-[#8E1F3B]">
          저장된 발주서 찾기 (이 프로젝트)
        </h3>
        <input
          className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          placeholder="공급업체명 또는 발주번호로 검색"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {poList.length === 0 && <p className="text-[11px] text-neutral-400">저장된 발주서가 없습니다.</p>}
          {poList.map((p) => (
            <div
              key={p.poNumber}
              className="flex items-center justify-between rounded-md bg-neutral-100 px-2.5 py-1.5 text-[11px]"
            >
              <span>
                <span className="mr-1.5 font-bold text-[#8E1F3B]">{p.poNumber}</span>
                {p.supplierName} · Rev.{String(p.latestRevision).padStart(2, "0")} · 품목 {p.itemCount}개
              </span>
              <button
                type="button"
                onClick={() => handleLoadRevision(p.poNumber, p.latestRevision)}
                className="rounded bg-[#8E1F3B] px-2 py-0.5 text-white"
              >
                불러오기
              </button>
            </div>
          ))}
        </div>

        <h3 className="mb-2 mt-5 border-b border-neutral-100 pb-1 text-[13px] font-semibold text-[#8E1F3B]">
          품목
        </h3>
        <ItemRowsEditor
          items={draft.items}
          onChange={(items) => set("items", items)}
          productNames={productNames}
          optionNames={optionNames}
          listId={nameListId}
        />

        <h3 className="mb-2 mt-4 border-b border-neutral-100 pb-1 text-[13px] font-semibold text-[#8E1F3B]">
          특기사항 (이 발주 건에만 해당하는 메모)
        </h3>
        <textarea
          rows={3}
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-xs"
          placeholder="예: 원단 컬러 재확인 필요"
          value={draft.note}
          onChange={(e) => set("note", e.target.value)}
        />

        <h3 className="mb-2 mt-4 border-b border-neutral-100 pb-1 text-[13px] font-semibold text-[#8E1F3B]">
          요청사항
        </h3>
        <textarea
          rows={3}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-xs"
          value={draft.requestNote}
          onChange={(e) => set("requestNote", e.target.value)}
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
          <PoPreview draft={draft} revision={revision || 1} logo={logo} company={company} />
        </div>
      </div>
    </div>
  );
}
