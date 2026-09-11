"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ImportableStatement,
  TaxInvoiceDraft,
  TaxInvoiceStatus,
  TaxInvoiceSummary,
} from "@/lib/tax-invoices/types";
import { TaxInvoicePreview, type TaxInvoiceCompanyInfo } from "@/components/tax-invoice/tax-invoice-preview";
import { ItemRowsEditor } from "@/components/quote/item-rows-editor";
import {
  confirmTaxInvoice,
  generateNewInvoiceNumber,
  importFromStatement,
  issueTaxInvoice,
  listImportableStatements,
  listTaxInvoices,
  loadTaxInvoice,
  requestTaxInvoice,
} from "./actions";

const STATUS_TEXT: Record<TaxInvoiceStatus, string> = {
  requested: "발행 요청됨",
  confirmed: "확인됨 (발행 대기)",
  issued: "발행 완료",
};

export function TaxInvoiceEditor({
  projectId,
  initialDraft,
  importableStatements,
  savedInvoices,
  productNames,
  optionNames,
  logo,
  seal,
  company,
}: {
  projectId: string;
  initialDraft: TaxInvoiceDraft;
  importableStatements: ImportableStatement[];
  savedInvoices: TaxInvoiceSummary[];
  productNames: string[];
  optionNames: string[];
  logo: string;
  seal: string;
  company: TaxInvoiceCompanyInfo;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<TaxInvoiceDraft>(initialDraft);
  const [statements, setStatements] = useState<ImportableStatement[]>(importableStatements);
  const [invoices, setInvoices] = useState<TaxInvoiceSummary[]>(savedInvoices);
  const [currentInvoiceId, setCurrentInvoiceId] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<TaxInvoiceStatus>("requested");
  const [saveHint, setSaveHint] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const nameListId = "tax-invoice-name-suggestions";

  function set<K extends keyof TaxInvoiceDraft>(key: K, value: TaxInvoiceDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleImportStatement(statementId: string, statementNumber: string) {
    const result = await importFromStatement(statementId);
    if (!result) return;
    setDraft((d) => ({
      ...d,
      statementId,
      customerName: result.customerName,
      customerBusinessNumber: result.customerBusinessNumber,
      customerAddress: result.customerAddress,
      items: result.items,
    }));
    setSaveHint(`${statementNumber}에서 품목을 가져왔습니다.`);
  }

  async function refreshLists() {
    const [nextStatements, nextInvoices] = await Promise.all([
      listImportableStatements(projectId),
      listTaxInvoices(projectId),
    ]);
    setStatements(nextStatements);
    setInvoices(nextInvoices);
  }

  async function handleRequest() {
    setIsBusy(true);
    setSaveError("");
    try {
      const result = await requestTaxInvoice(projectId, draft);
      setCurrentInvoiceId(result.id);
      setCurrentStatus("requested");
      setSaveHint(`발행 요청됨: ${draft.invoiceNumber} (${draft.customerName})`);
      await refreshLists();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "요청에 실패했습니다.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirm() {
    if (!currentInvoiceId) return;
    setIsBusy(true);
    setSaveError("");
    try {
      await confirmTaxInvoice(projectId, currentInvoiceId);
      setCurrentStatus("confirmed");
      setSaveHint(`확인됨: ${draft.invoiceNumber} — 발행 대기 중`);
      await refreshLists();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "확인 처리에 실패했습니다.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleIssue() {
    if (!currentInvoiceId) return;
    setIsBusy(true);
    setSaveError("");
    try {
      const result = await issueTaxInvoice(projectId, currentInvoiceId);
      setCurrentStatus("issued");
      setSaveHint(
        result.popbill === "sent"
          ? `발행 완료: ${draft.invoiceNumber} (팝빌 국세청 접수 완료${result.popbillMessage ? `, 승인번호 ${result.popbillMessage}` : ""})`
          : `발행 완료: ${draft.invoiceNumber} (팝빌 미연동 — 내부 상태만 기록됨)`
      );
      await refreshLists();
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "발행 처리에 실패했습니다.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleNewInvoice() {
    const invoiceNumber = await generateNewInvoiceNumber();
    setDraft({
      invoiceNumber,
      statementId: null,
      customerName: "",
      customerBusinessNumber: "",
      customerCeoName: "",
      customerAddress: "",
      customerBusinessType: "",
      customerBusinessItem: "",
      scheduledDate: new Date().toISOString().slice(0, 10),
      note: "",
      hometaxSent: false,
      items: [],
    });
    setCurrentInvoiceId(null);
    setCurrentStatus("requested");
    setSaveHint("");
    setSaveError("");
  }

  async function handleViewInvoice(invoiceId: string, status: TaxInvoiceStatus) {
    const result = await loadTaxInvoice(projectId, invoiceId);
    if (!result) return;
    setDraft(result);
    setCurrentInvoiceId(invoiceId);
    setCurrentStatus(status);
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
      const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "").trim();
      a.href = url;
      a.download = `세금계산서_${safe(draft.customerName || "고객사")}_${safe(draft.invoiceNumber)}.png`;
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
        <h2 className="mb-1 text-sm font-semibold text-neutral-900">세금계산서 발행</h2>
        <p className="mb-4 text-xs text-neutral-500">
          자동발행이 아니라 &ldquo;발행 요청 → 확인 → 발행&rdquo; 3단계로 진행합니다. 프로젝트 단계는
          실제 발행 완료 시에만 넘어갑니다.
        </p>

        {statements.length > 0 && (
          <div className="mb-4 rounded-md bg-[#eef7f0] p-3 text-[11.5px] text-[#2f7a4a]">
            아직 세금계산서가 안 붙은 거래명세서에서 품목을 가져올 수 있습니다.
            <div className="mt-2 flex flex-col gap-1">
              {statements.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded bg-white px-2 py-1.5">
                  <span>
                    <span className="font-bold text-[#8E1F3B]">{s.statementNumber}</span> {s.customerName} · 품목{" "}
                    {s.itemCount}개
                  </span>
                  <button
                    type="button"
                    onClick={() => handleImportStatement(s.id, s.statementNumber)}
                    className="rounded bg-[#2f7a4a] px-2 py-0.5 text-white"
                  >
                    📥 불러오기
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <label className="mb-1 block text-xs font-medium text-neutral-700">공급받는자 (고객사)</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.customerName}
          onChange={(e) => set("customerName", e.target.value)}
        />

        <p className="mb-1 text-[11px] text-neutral-400">
          아래는 사업자등록증 정보입니다. 거래명세서 발송 뒤에 늦게 받는 경우가 많아 선택 입력이며,
          등록번호·주소는 저장 시 연결된 거래명세서에도 함께 반영됩니다(거래명세서를 다시 보내지는
          않습니다).
        </p>
        <label className="mb-1 block text-xs font-medium text-neutral-700">사업자등록번호</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          placeholder="사업자등록증 수령 후 입력"
          value={draft.customerBusinessNumber}
          onChange={(e) => set("customerBusinessNumber", e.target.value)}
        />

        <label className="mb-1 block text-xs font-medium text-neutral-700">대표자 성명</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          placeholder="필요시 입력"
          value={draft.customerCeoName}
          onChange={(e) => set("customerCeoName", e.target.value)}
        />

        <label className="mb-1 block text-xs font-medium text-neutral-700">사업장 주소</label>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          placeholder="필요시 입력"
          value={draft.customerAddress}
          onChange={(e) => set("customerAddress", e.target.value)}
        />

        <div className="mb-3 flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-700">업태</label>
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              placeholder="필요시 입력"
              value={draft.customerBusinessType}
              onChange={(e) => set("customerBusinessType", e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-700">종목</label>
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              placeholder="필요시 입력"
              value={draft.customerBusinessItem}
              onChange={(e) => set("customerBusinessItem", e.target.value)}
            />
          </div>
        </div>

        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs font-medium text-neutral-700">세금계산서 번호</label>
          <button type="button" onClick={handleNewInvoice} className="text-[11px] text-neutral-500 underline">
            새 세금계산서로 시작
          </button>
        </div>
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.invoiceNumber}
          onChange={(e) => set("invoiceNumber", e.target.value)}
        />

        <label className="mb-1 block text-xs font-medium text-neutral-700">발행예정일</label>
        <input
          type="date"
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.scheduledDate}
          onChange={(e) => set("scheduledDate", e.target.value)}
        />

        <label className="mb-3 flex items-center gap-2 text-xs text-neutral-700">
          <input
            type="checkbox"
            checked={draft.hometaxSent}
            onChange={(e) => set("hometaxSent", e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300"
          />
          팝빌 연동 발송 완료 (현재는 수동 체크 — 추후 API/알림톡 자동화 예정)
        </label>

        {!currentInvoiceId ? (
          <button
            type="button"
            onClick={handleRequest}
            disabled={isBusy || !draft.customerName.trim() || !draft.invoiceNumber.trim() || !draft.statementId}
            className="mb-1 w-full rounded-md bg-[#2f7a4a] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {isBusy ? "요청 중..." : "1️⃣ 발행 요청"}
          </button>
        ) : (
          <div className="mb-1 flex flex-col gap-2">
            <p className="text-xs font-medium text-neutral-700">현재 상태: {STATUS_TEXT[currentStatus]}</p>
            {currentStatus === "requested" && (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isBusy}
                className="w-full rounded-md bg-[#2563eb] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {isBusy ? "처리 중..." : "2️⃣ 확인 처리"}
              </button>
            )}
            {currentStatus === "confirmed" && (
              <>
                <button
                  type="button"
                  onClick={handleIssue}
                  disabled={isBusy || !draft.customerBusinessNumber.trim()}
                  className="w-full rounded-md bg-[#8E1F3B] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {isBusy ? "처리 중..." : "3️⃣ 발행 완료 처리"}
                </button>
                {!draft.customerBusinessNumber.trim() && (
                  <p className="text-[11px] text-red-600">
                    사업자등록번호가 없으면 발행 완료 처리할 수 없습니다 — 사업자등록증을 받은 뒤 위에서 입력해주세요.
                  </p>
                )}
              </>
            )}
            {currentStatus === "issued" && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">
                발행이 완료됐습니다. 프로젝트 단계가 &ldquo;세금계산서 발행&rdquo;으로 전환됩니다.
              </p>
            )}
          </div>
        )}
        {saveHint && <p className="text-[11px] text-neutral-500">{saveHint}</p>}
        {saveError && <p className="rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-600">{saveError}</p>}

        {invoices.length > 0 && (
          <div className="mt-4 flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-700">저장된 세금계산서 (이 프로젝트)</label>
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between rounded-md bg-neutral-100 px-2.5 py-1.5 text-[11px]"
              >
                <span>
                  <span className="mr-1.5 font-bold text-[#8E1F3B]">{inv.invoiceNumber}</span>
                  {inv.customerName} · {STATUS_TEXT[inv.status]}
                </span>
                <button
                  type="button"
                  onClick={() => handleViewInvoice(inv.id, inv.status)}
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
          <TaxInvoicePreview draft={draft} status={currentStatus} logo={logo} seal={seal} company={company} />
        </div>
      </div>
    </div>
  );
}
