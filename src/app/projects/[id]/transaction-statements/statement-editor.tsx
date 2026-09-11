"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ImportablePO,
  QuoteReferenceSummary,
  QuoteSearchResult,
  StatementDraft,
  StatementSummary,
} from "@/lib/transaction-statements/types";
import { StatementPreview, type StatementCompanyInfo } from "@/components/statement/statement-preview";
import { ItemRowsEditor } from "@/components/quote/item-rows-editor";
import {
  generateNewStatementNumber,
  getQuoteReferenceById,
  getQuoteReferenceByNumber,
  importItemsFromPO,
  loadStatement,
  markCashReceiptIssued,
  recordCustomerPayment,
  saveStatement,
  searchQuotesForStatementLink,
} from "./actions";

// 견적서에 담긴 값(고객에게 청구하는 매출 단가)을 그대로 거래명세서 품목으로 옮긴다 —
// 발주서 품목(공급업체 매입 단가)과는 금액 기준이 다르므로 절대 섞어 쓰지 않는다.
function quoteItemsToStatementItems(items: QuoteReferenceSummary["items"]): StatementDraft["items"] {
  return items.map((it) => ({
    uid: it.id,
    lineType: it.lineType === "option" ? "option" : "product",
    code: "",
    name: it.name,
    spec: it.spec,
    unit: it.unit || "개",
    qty: it.qty,
    price: it.price,
    supplyOverride: it.supplyOverride,
    quoteItemId: it.id,
  }));
}

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function StatementEditor({
  projectId,
  initialDraft,
  importablePOs,
  savedStatements,
  productNames,
  optionNames,
  seal,
  company,
  initialQuoteReference,
}: {
  projectId: string;
  initialDraft: StatementDraft;
  importablePOs: ImportablePO[];
  savedStatements: StatementSummary[];
  productNames: string[];
  optionNames: string[];
  seal: string;
  company: StatementCompanyInfo;
  initialQuoteReference: QuoteReferenceSummary | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<StatementDraft>(initialDraft);
  const [statements, setStatements] = useState<StatementSummary[]>(savedStatements);
  const [saveHint, setSaveHint] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [paymentHint, setPaymentHint] = useState("");
  const [isSavingReceipt, setIsSavingReceipt] = useState(false);
  const [receiptHint, setReceiptHint] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const nameListId = "statement-name-suggestions";

  const [selectedQuote, setSelectedQuote] = useState<QuoteReferenceSummary | null>(initialQuoteReference);
  const [showQuotePicker, setShowQuotePicker] = useState(!initialQuoteReference);
  const [quoteSearchQuery, setQuoteSearchQuery] = useState("");
  const [quoteSearchResults, setQuoteSearchResults] = useState<QuoteSearchResult[]>([]);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const debouncedQuoteSearch = useDebounced(quoteSearchQuery, 250);

  useEffect(() => {
    let cancelled = false;
    searchQuotesForStatementLink(projectId, debouncedQuoteSearch).then((r) => {
      if (!cancelled) setQuoteSearchResults(r);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, debouncedQuoteSearch]);

  function set<K extends keyof StatementDraft>(key: K, value: StatementDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleSavePayment() {
    if (!draft.id) return;
    setIsSavingPayment(true);
    setPaymentHint("");
    try {
      await recordCustomerPayment(projectId, draft.id, draft.paidCash, draft.paidCard, draft.paidDate);
      setPaymentHint("결제 기록이 저장되었습니다.");
      router.refresh();
    } finally {
      setIsSavingPayment(false);
    }
  }

  async function handleSaveCashReceipt() {
    if (!draft.id) return;
    setIsSavingReceipt(true);
    setReceiptHint("");
    try {
      await markCashReceiptIssued(projectId, draft.id, draft.cashReceiptIssuedAt);
      setReceiptHint(draft.cashReceiptIssuedAt ? "현금영수증 발행일이 저장되었습니다." : "발행일이 지워졌습니다.");
      router.refresh();
    } finally {
      setIsSavingReceipt(false);
    }
  }

  async function handleSelectQuote(quoteNumber: string) {
    setIsLoadingQuote(true);
    try {
      const quote = await getQuoteReferenceByNumber(projectId, quoteNumber);
      if (quote) {
        setSelectedQuote(quote);
        // 고객이 확정한 견적 내용(수신 고객사명/담당자/품명/수량/단가)을 그대로 거래명세서에 채운다.
        setDraft((d) => ({
          ...d,
          quoteId: quote.id,
          customerName: quote.customerName,
          customerContactName: quote.contactName,
          items: quoteItemsToStatementItems(quote.items),
        }));
        setShowQuotePicker(false);
      }
    } finally {
      setIsLoadingQuote(false);
    }
  }

  async function handleImportPO(poNumber: string) {
    const result = await importItemsFromPO(projectId, poNumber);
    if (!result) return;
    setDraft((d) => ({
      ...d,
      purchaseOrderId: result.purchaseOrderId,
      quoteId: result.quoteId ?? d.quoteId,
      items: result.items,
    }));
    // 그 발주서가 이미 특정 견적에 연결돼 있으면(발주서 작성 때 "불러오기"로 확인한 값)
    // 그대로 이어받아 참고 카드에 보여준다 — 새로 추측하는 게 아니라 이미 확정된 연결이다.
    if (result.quoteId && result.quoteId !== selectedQuote?.id) {
      const quote = await getQuoteReferenceById(result.quoteId);
      if (quote) {
        setSelectedQuote(quote);
        setDraft((d) => ({ ...d, customerName: quote.customerName, customerContactName: quote.contactName }));
        setShowQuotePicker(false);
      }
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError("");
    try {
      const result = await saveStatement(projectId, draft);
      setSaveHint(`저장(발송)됨: ${draft.statementNumber} (${draft.customerName}) — 총 ${draft.items.length}개 품목`);
      const newNumber = await generateNewStatementNumber();
      setStatements((prev) => [
        {
          id: result.id,
          statementNumber: draft.statementNumber,
          customerName: draft.customerName,
          statementDate: draft.statementDate,
          itemCount: draft.items.length,
          createdAt: new Date().toISOString(),
          quoteNumber: selectedQuote?.quoteNumber ?? null,
        },
        ...prev,
      ]);
      setDraft((d) => ({ ...d, statementNumber: newNumber }));
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleViewStatement(statementId: string) {
    const result = await loadStatement(projectId, statementId);
    if (!result) return;
    setDraft(result);
    setSaveHint("");
    setSaveError("");
    setPaymentHint("");
    setReceiptHint("");

    if (result.quoteId) {
      const quote = await getQuoteReferenceById(result.quoteId);
      setSelectedQuote(quote);
      setShowQuotePicker(!quote);
    } else {
      setSelectedQuote(null);
      setShowQuotePicker(true);
    }
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
      a.download = `거래명세서-${safe(draft.customerName || "고객사")}_${productShort}.png`;
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
        <h2 className="mb-1 text-sm font-semibold text-neutral-900">거래명세서 작성</h2>
        <p className="mb-4 text-xs text-neutral-500">
          견적서를 불러오면 고객이 확정한 품목·단가가 그대로 채워집니다. 리비전 없이
          저장(발송)하면 그대로 확정되는 문서입니다 — 분할 출고 등 새로 보낼 게 있으면 새
          번호로 다시 작성하세요.
        </p>

        <div className="mb-4 rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3">
          <label className="mb-1 block text-xs font-medium text-neutral-700">어느 견적서에 대한 거래명세서인가요?</label>
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

        {importablePOs.length > 0 && (
          <div className="mb-4 rounded-md bg-[#eef7f0] p-3 text-[11.5px] text-[#2f7a4a]">
            발주서 품목을 가져올 수도 있습니다 (참고: 발주서는 공급업체 매입 단가라 고객
            청구액과 다릅니다 — 보통은 위 견적서 불러오기만 쓰면 됩니다).
            <div className="mt-2 flex flex-col gap-1">
              {importablePOs.map((po) => (
                <div key={po.poNumber} className="flex items-center justify-between rounded bg-white px-2 py-1.5">
                  <span>
                    <span className="font-bold text-[#8E1F3B]">{po.poNumber}</span> {po.supplierName} · 품목{" "}
                    {po.itemCount}개
                  </span>
                  <button
                    type="button"
                    onClick={() => handleImportPO(po.poNumber)}
                    className="rounded bg-[#2f7a4a] px-2 py-0.5 text-white"
                  >
                    📥 불러오기
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <label className="mb-1 block text-xs font-medium text-neutral-700">수신 고객사</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.customerName}
          onChange={(e) => set("customerName", e.target.value)}
        />

        <p className="mb-1 text-[11px] text-neutral-400">
          아래 세 항목은 견적서에는 없는 값이라 필요할 때만 입력하세요 (등록번호는 보통 사업자등록증 사본을 받은 뒤 채워집니다).
        </p>
        <label className="mb-1 block text-xs font-medium text-neutral-700">등록번호</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          placeholder="필요시 입력"
          value={draft.customerBusinessNumber}
          onChange={(e) => set("customerBusinessNumber", e.target.value)}
        />

        <label className="mb-1 block text-xs font-medium text-neutral-700">담당자</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          placeholder="필요시 입력"
          value={draft.customerContactName}
          onChange={(e) => set("customerContactName", e.target.value)}
        />

        <label className="mb-1 block text-xs font-medium text-neutral-700">주소</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          placeholder="필요시 입력"
          value={draft.customerAddress}
          onChange={(e) => set("customerAddress", e.target.value)}
        />

        <label className="mb-1 block text-xs font-medium text-neutral-700">거래명세서 번호</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.statementNumber}
          onChange={(e) => set("statementNumber", e.target.value)}
        />

        <label className="mb-1 block text-xs font-medium text-neutral-700">거래일자</label>
        <input
          type="date"
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.statementDate}
          onChange={(e) => set("statementDate", e.target.value)}
        />

        <label className="mb-1 block text-xs font-medium text-neutral-700">미수금 (선택)</label>
        <input
          type="number"
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          placeholder="발주와 동시에 입금되지 않은 경우에만 입력"
          value={draft.outstandingAmount}
          onChange={(e) => set("outstandingAmount", e.target.value)}
        />

        {draft.id && (
          <>
            <div className="mb-3 rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3">
              <label className="mb-1 block text-xs font-medium text-neutral-700">고객 결제 입력</label>
              <p className="mb-2 text-[11px] text-neutral-400">
                현금 입금은 참고용 기록입니다(별도로 세금계산서 또는 현금영수증을 발행해야 다음 단계로
                진행됩니다). 카드 결제는 매출전표 자체가 영수증을 대신하므로, 카드 결제액을 입력하면 그
                자체로 다음 단계(영수증 발행)로 진행됩니다 — 금액은 수기 입력, 결제일만 있으면 됩니다.
              </p>
              <div className="mb-2 flex gap-2">
                <input
                  type="number"
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  placeholder="현금"
                  value={draft.paidCash}
                  onChange={(e) => set("paidCash", e.target.value)}
                />
                <input
                  type="number"
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  placeholder="카드"
                  value={draft.paidCard}
                  onChange={(e) => set("paidCard", e.target.value)}
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
                {isSavingPayment ? "저장 중..." : "결제 기록 저장"}
              </button>
              {paymentHint && <p className="mt-1 text-[11px] text-neutral-500">{paymentHint}</p>}
            </div>

            <div className="mb-3 rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3">
              <label className="mb-1 block text-xs font-medium text-neutral-700">현금영수증 발행일</label>
              <p className="mb-2 text-[11px] text-neutral-400">
                현금 입금 건 중 세금계산서 대신 현금영수증을 요청한 경우에만 입력하세요. 세금계산서/
                현금영수증/카드결제 중 하나만 있으면 다음 단계(영수증 발행)로 진행됩니다.
              </p>
              <div className="mb-2 flex gap-2">
                <input
                  type="date"
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  value={draft.cashReceiptIssuedAt}
                  onChange={(e) => set("cashReceiptIssuedAt", e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={handleSaveCashReceipt}
                disabled={isSavingReceipt}
                className="w-full rounded-md bg-neutral-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {isSavingReceipt ? "저장 중..." : "현금영수증 발행일 저장"}
              </button>
              {receiptHint && <p className="mt-1 text-[11px] text-neutral-500">{receiptHint}</p>}
            </div>
          </>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !draft.customerName.trim() || !draft.statementNumber.trim() || !draft.quoteId}
          className="mb-1 w-full rounded-md bg-[#2f7a4a] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {isSaving ? "저장 중..." : "💾 이 거래명세서 저장 (발송 확정)"}
        </button>
        {!draft.quoteId && (
          <p className="mt-1 text-[11px] text-red-600">먼저 위에서 견적서를 불러와야 저장할 수 있습니다.</p>
        )}
        {saveHint && <p className="text-[11px] text-neutral-500">{saveHint}</p>}
        {saveError && <p className="rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-600">{saveError}</p>}

        {statements.length > 0 && (
          <div className="mt-4 flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-700">저장된 거래명세서 (이 프로젝트)</label>
            {statements.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-md bg-neutral-100 px-2.5 py-1.5 text-[11px]"
              >
                <span>
                  <span className="mr-1.5 font-bold text-[#8E1F3B]">{s.statementNumber}</span>
                  {s.customerName} · {s.statementDate} · 품목 {s.itemCount}개
                  {s.quoteNumber && <span className="text-neutral-400"> · {s.quoteNumber}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => handleViewStatement(s.id)}
                  className="rounded bg-[#8E1F3B] px-2 py-0.5 text-white"
                >
                  보기
                </button>
              </div>
            ))}
          </div>
        )}

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
          절삭 (선택)
        </h3>
        <p className="mb-2 text-[11px] text-neutral-400">
          거래명세서 총액을 특정 금액에 맞추기 위해 최종 합계를 조정할 때만 입력하세요 — 품목 계산과는 별개로
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

        <h3 className="mb-2 mt-4 border-b border-neutral-100 pb-1 text-[13px] font-semibold text-[#8E1F3B]">
          비고
        </h3>
        <textarea
          rows={3}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-xs"
          value={draft.note}
          onChange={(e) => set("note", e.target.value)}
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
          <StatementPreview draft={draft} seal={seal} company={company} />
        </div>
      </div>
    </div>
  );
}
