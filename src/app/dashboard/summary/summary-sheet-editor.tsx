"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SummaryRow } from "@/lib/dashboard/summary-sheet";
import { recordSupplierPayment } from "@/app/projects/[id]/purchase-orders/actions";
import { recordCustomerPayment, markCashReceiptIssued } from "@/app/projects/[id]/transaction-statements/actions";
import { addProjectRequest } from "@/app/projects/[id]/requests-actions";
import { updateSummaryOverride } from "./actions";

function won(v: number | null): string {
  if (v == null) return "-";
  return `${Math.round(v).toLocaleString("ko-KR")}원`;
}

// 매출이익금은 공급가 기준(SummaryRow.profit, 부가세 미포함)으로 계산되어 저장돼 있다 —
// 대시보드 실적 카드와 같은 원칙으로(2026-09-10), 화면에 "보여줄 때"만 부가세 10%를
// 더한다. summary-sheet.ts의 원본 데이터(정정값 시스템, 대시보드 집계)는 그대로 공급가
// 기준을 유지해야 해서 여기서만 표시용으로 변환한다.
function wonWithVat(v: number | null): string {
  if (v == null) return "-";
  return won(Math.round(v * 1.1));
}

function pct(v: number | null): string {
  if (v == null) return "-";
  return `${(v * 100).toFixed(1)}%`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type EditableRow = SummaryRow & {
  _outAmountDraft: string;
  _paidCashDraft: string;
  _paidCardDraft: string;
  _cashReceiptDraft: string;
  _requestDraft: string;
  _orderDateDraft: string;
  _contactNameDraft: string;
  _customerNameDraft: string;
  _contactPhoneDraft: string;
  _productCodeDraft: string;
  _productNameDraft: string;
  _qtyDraft: string;
  _reqDateDraft: string;
  _supplierNameDraft: string;
  _supplierPhoneDraft: string;
  _shipDateDraft: string;
};

// 정정된 필드는 원본 문서(견적서/발주서/배송기록)가 아니라 summary_overrides에만 반영된다
// (2026-09-03 — 원본은 고객·공급업체에 실제로 보낸 문서라 그대로 남아야 한다는 피드백).
// overriddenFields는 그 사실을 화면에 표시(노란 배경)하기 위한 UI 전용 마커.
function markOverridden(r: EditableRow, fields: string[]): EditableRow {
  const set = new Set(r.overriddenFields);
  for (const f of fields) set.add(f);
  return { ...r, overriddenFields: Array.from(set) };
}

function toEditable(r: SummaryRow): EditableRow {
  return {
    ...r,
    _outAmountDraft: r.outAmount,
    _paidCashDraft: r.paidCash,
    _paidCardDraft: r.paidCard,
    _cashReceiptDraft: r.cashReceiptIssuedAt,
    _requestDraft: "",
    _orderDateDraft: r.orderDate,
    _contactNameDraft: r.contactName,
    _customerNameDraft: r.customerName,
    _contactPhoneDraft: r.contactPhone,
    _productCodeDraft: r.productCode,
    _productNameDraft: r.productName,
    _qtyDraft: r.qty,
    _reqDateDraft: r.reqDate,
    _supplierNameDraft: r.supplierName,
    _supplierPhoneDraft: r.supplierPhone,
    _shipDateDraft: r.shipDate,
  };
}

export function SummarySheetEditor({
  initialRows,
}: {
  initialRows: SummaryRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<EditableRow[]>(initialRows.map(toEditable));
  const [hideUnconverted, setHideUnconverted] = useState(false);
  // 과거 이력(엑셀 이관, 3천여 건)은 기본적으로 숨겨둔다 — 그대로 다 보여주면 오늘 처리해야
  // 할 최근 건들이 이력 속에 파묻힌다. 필요할 때만 체크해서 본다.
  const [showHistorical, setShowHistorical] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const historicalCount = rows.filter((r) => r.isHistorical).length;

  function updateDraft(rowKey: string, field: keyof EditableRow, value: string) {
    setRows((rs) => rs.map((r) => (r.rowKey === rowKey ? { ...r, [field]: value } : r)));
  }

  async function saveOutAmount(row: EditableRow) {
    if (!row.poId) return;
    setSavingKey(`out-${row.rowKey}`);
    try {
      await recordSupplierPayment(row.projectId, row.poId, row._outAmountDraft, today());
      setRows((rs) => rs.map((r) => (r.rowKey === row.rowKey ? { ...r, outAmount: row._outAmountDraft } : r)));
      router.refresh();
    } finally {
      setSavingKey(null);
    }
  }

  async function savePayment(row: EditableRow) {
    if (!row.statementId) return;
    setSavingKey(`pay-${row.rowKey}`);
    try {
      await recordCustomerPayment(row.projectId, row.statementId, row._paidCashDraft, row._paidCardDraft, today());
      setRows((rs) =>
        rs.map((r) =>
          r.rowKey === row.rowKey ? { ...r, paidCash: row._paidCashDraft, paidCard: row._paidCardDraft } : r
        )
      );
      router.refresh();
    } finally {
      setSavingKey(null);
    }
  }

  async function saveCashReceipt(row: EditableRow) {
    if (!row.statementId) return;
    setSavingKey(`receipt-${row.rowKey}`);
    try {
      await markCashReceiptIssued(row.projectId, row.statementId, row._cashReceiptDraft);
      setRows((rs) =>
        rs.map((r) => (r.rowKey === row.rowKey ? { ...r, cashReceiptIssuedAt: row._cashReceiptDraft } : r))
      );
      router.refresh();
    } finally {
      setSavingKey(null);
    }
  }

  async function addRequest(row: EditableRow) {
    if (!row._requestDraft.trim()) return;
    setSavingKey(`req-${row.rowKey}`);
    try {
      await addProjectRequest(row.projectId, "customer", row._requestDraft);
      updateDraft(row.rowKey, "_requestDraft", "");
      router.refresh();
    } finally {
      setSavingKey(null);
    }
  }

  // 아래부터는 "기본은 견적서/발주서에서 끌어오지만 공급업체 사정 등으로 바뀌면 이 표에서
  // 바로 고칠 수 있어야 한다"는 요청(2026-09-03)에 따라 추가한 저장 함수들 — 전부 새
  // 리비전을 만들지 않고 견적/발주 원본 행을 그대로 UPDATE한다(발송요청일 수정과 같은 패턴).
  async function saveQuoteHeader(row: EditableRow) {
    if (!row.quoteId) return;
    setSavingKey(`qhead-${row.rowKey}`);
    try {
      await updateSummaryOverride(row.rowKey, {
        orderDate: row._orderDateDraft,
        contactName: row._contactNameDraft,
        customerName: row._customerNameDraft,
        contactPhone: row._contactPhoneDraft,
      });
      setRows((rs) =>
        rs.map((r) =>
          r.rowKey === row.rowKey
            ? markOverridden(
                {
                  ...r,
                  orderDate: row._orderDateDraft,
                  contactName: row._contactNameDraft,
                  customerName: row._customerNameDraft,
                  contactPhone: row._contactPhoneDraft,
                },
                ["orderDate", "contactName", "customerName", "contactPhone"]
              )
            : r
        )
      );
      router.refresh();
    } finally {
      setSavingKey(null);
    }
  }

  async function saveQuoteItem(row: EditableRow) {
    if (!row.quoteItemId) return;
    setSavingKey(`qitem-${row.rowKey}`);
    try {
      await updateSummaryOverride(row.rowKey, {
        productCode: row._productCodeDraft,
        productName: row._productNameDraft,
        qty: row._qtyDraft,
      });
      setRows((rs) =>
        rs.map((r) =>
          r.rowKey === row.rowKey
            ? markOverridden(
                { ...r, productCode: row._productCodeDraft, productName: row._productNameDraft, qty: row._qtyDraft },
                ["productCode", "productName", "qty"]
              )
            : r
        )
      );
      router.refresh();
    } finally {
      setSavingKey(null);
    }
  }

  async function saveReqDate(row: EditableRow) {
    if (!row.poId) return;
    setSavingKey(`reqdate-${row.rowKey}`);
    try {
      await updateSummaryOverride(row.rowKey, { reqDate: row._reqDateDraft });
      setRows((rs) =>
        rs.map((r) => (r.rowKey === row.rowKey ? markOverridden({ ...r, reqDate: row._reqDateDraft }, ["reqDate"]) : r))
      );
      router.refresh();
    } finally {
      setSavingKey(null);
    }
  }

  async function saveSupplierInfo(row: EditableRow) {
    if (!row.poId) return;
    setSavingKey(`supplier-${row.rowKey}`);
    try {
      await updateSummaryOverride(row.rowKey, {
        supplierName: row._supplierNameDraft,
        supplierPhone: row._supplierPhoneDraft,
      });
      setRows((rs) =>
        rs.map((r) =>
          r.rowKey === row.rowKey
            ? markOverridden(
                { ...r, supplierName: row._supplierNameDraft, supplierPhone: row._supplierPhoneDraft },
                ["supplierName", "supplierPhone"]
              )
            : r
        )
      );
      router.refresh();
    } finally {
      setSavingKey(null);
    }
  }

  async function saveShipDate(row: EditableRow) {
    if (!row.poId) return;
    setSavingKey(`ship-${row.rowKey}`);
    try {
      await updateSummaryOverride(row.rowKey, { shipDate: row._shipDateDraft });
      setRows((rs) =>
        rs.map((r) => (r.rowKey === row.rowKey ? markOverridden({ ...r, shipDate: row._shipDateDraft }, ["shipDate"]) : r))
      );
      router.refresh();
    } finally {
      setSavingKey(null);
    }
  }

  const visibleRows = rows
    .filter((r) => !hideUnconverted || r.statementId)
    .filter((r) => showHistorical || !r.isHistorical);

  // 엑셀 틀고정처럼 헤더 2줄(위쪽 top-0 / 아래쪽 top-8, 32px = 위쪽 줄 높이)과 첫 번째
  // 컬럼(날짜, left-0)을 스크롤해도 고정해서 보이게 한다(2026-09-03, 행이 3천 건대까지
  // 늘어난 뒤로 "전체 화면을 볼 수 없다"는 피드백). 표 컨테이너 자체를 max-h로 감싸서
  // 그 안에서 스크롤하게 하고(overflow-auto), 헤더/첫 컬럼은 그 스크롤 컨테이너 기준으로
  // sticky 처리한다.
  const th = "h-8 border-b border-neutral-200 bg-neutral-50 px-2 py-1.5 text-neutral-500 sticky top-0 z-20";
  const thGroup = "h-7 border-b border-neutral-100 bg-neutral-50 px-2 py-1 text-neutral-400 sticky top-8 z-20";
  const thCorner = "h-8 border-b border-neutral-200 bg-neutral-50 px-2 py-1.5 text-neutral-500 sticky top-0 left-0 z-30";
  function firstColCls(r: EditableRow): string {
    return `sticky left-0 z-10 px-2 py-1.5 ${r.isHistorical ? "bg-neutral-50" : "bg-white"}`;
  }
  const inputCls = "rounded border border-neutral-300 px-1.5 py-1";
  const saveBtnCls = "shrink-0 rounded bg-neutral-700 px-1.5 py-1 text-white disabled:opacity-50";
  // 정정된(원본과 다른) 값은 노란 배경으로 표시 — 어떤 칸이 견적서/발주서 원본과 달라졌는지
  // 한눈에 구분하기 위함.
  function fieldCls(r: EditableRow, field: string, width: string): string {
    const overridden = r.overriddenFields.includes(field);
    return `${inputCls} ${width} ${overridden ? "border-amber-400 bg-amber-50" : ""}`;
  }
  function fieldTitle(r: EditableRow, field: string): string | undefined {
    return r.overriddenFields.includes(field) ? "Summary에서 직접 고친 값 — 원본 문서와 다릅니다." : undefined;
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-6">
          <Link href="/dashboard" className="text-sm text-neutral-500 hover:underline">
            ← 대시보드
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-neutral-900">Summary</h1>
          <p className="mt-1 text-sm text-neutral-500">
            견적 품목 하나가 한 행입니다 — 발주·거래명세서가 아직 없어도 견적만으로 행이 생깁니다. 기본은
            견적서/발주서 내용을 그대로 보여주지만, 공급업체 사정 등으로 바뀌면 이 표의 각 칸을 직접 고쳐
            저장할 수 있습니다. 이렇게 고친 값은 <span className="rounded bg-amber-50 px-1 text-amber-700">노란 배경</span>으로
            표시되고, 실제 견적서·발주서 원본(고객·공급업체에 보낸 문서)은 바뀌지 않습니다 — Summary 화면에
            보이는 값만 정정됩니다.
          </p>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">상품별 상세</h2>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-neutral-600">
              <input type="checkbox" checked={hideUnconverted} onChange={(e) => setHideUnconverted(e.target.checked)} />
              매출로 이어지지 않은 건(거래명세서 없음) 숨기기
            </label>
            <label className="flex items-center gap-1.5 text-xs text-neutral-600">
              <input type="checkbox" checked={showHistorical} onChange={(e) => setShowHistorical(e.target.checked)} />
              과거 이력(엑셀 이관, {historicalCount}건) 표시 — 읽기 전용, 최근 실입력분과 일부 겹칠 수 있음
            </label>
          </div>
        </div>

        <div className="max-h-[75vh] overflow-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full whitespace-nowrap text-xs">
            <thead>
              <tr className="text-left">
                <th rowSpan={2} className={thCorner}>날짜</th>
                <th rowSpan={2} className={th}>담당자</th>
                <th rowSpan={2} className={th}>기관명</th>
                <th rowSpan={2} className={th}>연락처</th>
                <th rowSpan={2} className={th}>상품코드</th>
                <th rowSpan={2} className={th}>상품명</th>
                <th rowSpan={2} className={`${th} text-right`}>수량</th>
                <th rowSpan={2} className={th}>납기</th>
                <th rowSpan={2} className={th}>고객 요청사항</th>
                <th colSpan={2} className={`${th} text-center`}>고객 입금</th>
                <th colSpan={3} className={`${th} text-center`}>영수증</th>
                <th rowSpan={2} className={th}>공급업체</th>
                <th rowSpan={2} className={th}>공급업체 연락처</th>
                <th rowSpan={2} className={th}>출고날짜(발송일)</th>
                <th rowSpan={2} className={th}>출금</th>
                <th rowSpan={2} className={`${th} text-right`}>매출이익금</th>
                <th rowSpan={2} className={`${th} text-right`}>매출이익률</th>
              </tr>
              <tr className="text-left">
                <th className={thGroup}>현금</th>
                <th className={thGroup}>카드</th>
                <th className={thGroup}>세금계산서</th>
                <th className={thGroup}>현금영수증</th>
                <th className={thGroup}>카드영수증</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={20} className="px-3 py-6 text-center text-neutral-400">
                    표시할 행이 없습니다.
                  </td>
                </tr>
              ) : (
                visibleRows.map((r) => (
                  <tr
                    key={r.rowKey}
                    className={`border-b border-neutral-100 last:border-0 hover:bg-neutral-50 ${r.isHistorical ? "bg-neutral-50/70" : ""}`}
                  >
                    {/* 날짜/담당자/기관명 — 견적 헤더. quoteId가 있을 때만 편집 가능, 연락처 칸에 저장 버튼.
                        날짜 칸은 틀고정 첫 컬럼이라 스크롤해도 항상 보인다. */}
                    <td className={firstColCls(r)}>
                      {r.quoteId ? (
                        <input
                          type="date"
                          className={fieldCls(r, "orderDate", "w-28")}
                          title={fieldTitle(r, "orderDate")}
                          value={r._orderDateDraft}
                          onChange={(e) => updateDraft(r.rowKey, "_orderDateDraft", e.target.value)}
                        />
                      ) : (
                        <span>
                          {r.orderDate || "-"}
                          {r.isHistorical && (
                            <span className="ml-1 rounded bg-neutral-200 px-1 py-0.5 text-[10px] text-neutral-500">
                              이력
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.quoteId ? (
                        <input
                          type="text"
                          className={fieldCls(r, "contactName", "w-16")}
                          title={fieldTitle(r, "contactName")}
                          value={r._contactNameDraft}
                          onChange={(e) => updateDraft(r.rowKey, "_contactNameDraft", e.target.value)}
                        />
                      ) : (
                        r.contactName || "-"
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.quoteId ? (
                        <input
                          type="text"
                          className={fieldCls(r, "customerName", "w-24")}
                          title={fieldTitle(r, "customerName")}
                          value={r._customerNameDraft}
                          onChange={(e) => updateDraft(r.rowKey, "_customerNameDraft", e.target.value)}
                        />
                      ) : r.projectId ? (
                        <Link href={`/projects/${r.projectId}`} className="hover:underline">
                          {r.customerName}
                        </Link>
                      ) : (
                        r.customerName
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.quoteId ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            className={fieldCls(r, "contactPhone", "w-24")}
                            title={fieldTitle(r, "contactPhone")}
                            value={r._contactPhoneDraft}
                            onChange={(e) => updateDraft(r.rowKey, "_contactPhoneDraft", e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => saveQuoteHeader(r)}
                            disabled={savingKey === `qhead-${r.rowKey}`}
                            className={saveBtnCls}
                          >
                            저장
                          </button>
                        </div>
                      ) : (
                        r.contactPhone || "-"
                      )}
                    </td>

                    {/* 상품코드/상품명/수량 — 견적 품목. quoteItemId가 있을 때만 편집 가능, 수량 칸에 저장 버튼. */}
                    <td className="px-2 py-1.5">
                      {r.quoteItemId ? (
                        <input
                          type="text"
                          className={fieldCls(r, "productCode", "w-16")}
                          title={fieldTitle(r, "productCode")}
                          value={r._productCodeDraft}
                          onChange={(e) => updateDraft(r.rowKey, "_productCodeDraft", e.target.value)}
                        />
                      ) : (
                        r.productCode || "-"
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.quoteItemId ? (
                        <input
                          type="text"
                          className={fieldCls(r, "productName", "w-28")}
                          title={fieldTitle(r, "productName")}
                          value={r._productNameDraft}
                          onChange={(e) => updateDraft(r.rowKey, "_productNameDraft", e.target.value)}
                        />
                      ) : (
                        r.productName
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {r.quoteItemId ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            className={fieldCls(r, "qty", "w-14")}
                            title={fieldTitle(r, "qty")}
                            value={r._qtyDraft}
                            onChange={(e) => updateDraft(r.rowKey, "_qtyDraft", e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => saveQuoteItem(r)}
                            disabled={savingKey === `qitem-${r.rowKey}`}
                            className={saveBtnCls}
                          >
                            저장
                          </button>
                        </div>
                      ) : (
                        r.qty || "-"
                      )}
                    </td>

                    {/* 납기 — 발주서 발송요청일. poId가 있을 때만 편집 가능(공급업체 사정으로 바뀌는 실무 사례). */}
                    <td className="px-2 py-1.5">
                      {r.poId ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="date"
                            className={fieldCls(r, "reqDate", "w-28")}
                            title={fieldTitle(r, "reqDate")}
                            value={r._reqDateDraft}
                            onChange={(e) => updateDraft(r.rowKey, "_reqDateDraft", e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => saveReqDate(r)}
                            disabled={savingKey === `reqdate-${r.rowKey}`}
                            className={saveBtnCls}
                          >
                            저장
                          </button>
                        </div>
                      ) : (
                        r.reqDate || "-"
                      )}
                    </td>

                    <td className="px-2 py-1.5">
                      <div className="flex max-w-[220px] items-center gap-1">
                        {r.customerRequests && (
                          <span className="truncate text-neutral-700" title={r.customerRequests}>
                            {r.customerRequests}
                          </span>
                        )}
                        {r.projectId && (
                          <>
                            <input
                              type="text"
                              placeholder="추가..."
                              className="w-20 shrink-0 rounded border border-neutral-300 px-1.5 py-1"
                              value={r._requestDraft}
                              onChange={(e) => updateDraft(r.rowKey, "_requestDraft", e.target.value)}
                            />
                            <button
                              type="button"
                              onClick={() => addRequest(r)}
                              disabled={savingKey === `req-${r.rowKey}` || !r._requestDraft.trim()}
                              className={saveBtnCls}
                            >
                              추가
                            </button>
                          </>
                        )}
                      </div>
                    </td>

                    <td className="px-2 py-1.5">
                      {r.statementId ? (
                        <input
                          type="number"
                          className={`${inputCls} w-16`}
                          value={r._paidCashDraft}
                          onChange={(e) => updateDraft(r.rowKey, "_paidCashDraft", e.target.value)}
                        />
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.statementId ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            className={`${inputCls} w-16`}
                            value={r._paidCardDraft}
                            onChange={(e) => updateDraft(r.rowKey, "_paidCardDraft", e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => savePayment(r)}
                            disabled={savingKey === `pay-${r.rowKey}`}
                            className={saveBtnCls}
                          >
                            저장
                          </button>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>

                    <td className="px-2 py-1.5 text-neutral-600">{r.taxInvoiceIssuedAt || "-"}</td>
                    <td className="px-2 py-1.5">
                      {r.statementId ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="date"
                            className={`${inputCls} w-28`}
                            value={r._cashReceiptDraft}
                            onChange={(e) => updateDraft(r.rowKey, "_cashReceiptDraft", e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => saveCashReceipt(r)}
                            disabled={savingKey === `receipt-${r.rowKey}`}
                            className={saveBtnCls}
                          >
                            저장
                          </button>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-neutral-600">{r.cardReceiptIssuedAt || "-"}</td>

                    {/* 공급업체/공급업체 연락처 — 발주서. poId가 있을 때만 편집 가능, 연락처 칸에 저장 버튼. */}
                    <td className="px-2 py-1.5">
                      {r.poId ? (
                        <input
                          type="text"
                          className={fieldCls(r, "supplierName", "w-24")}
                          title={fieldTitle(r, "supplierName")}
                          value={r._supplierNameDraft}
                          onChange={(e) => updateDraft(r.rowKey, "_supplierNameDraft", e.target.value)}
                        />
                      ) : (
                        r.supplierName || "-"
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.poId ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            className={fieldCls(r, "supplierPhone", "w-24")}
                            title={fieldTitle(r, "supplierPhone")}
                            value={r._supplierPhoneDraft}
                            onChange={(e) => updateDraft(r.rowKey, "_supplierPhoneDraft", e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => saveSupplierInfo(r)}
                            disabled={savingKey === `supplier-${r.rowKey}`}
                            className={saveBtnCls}
                          >
                            저장
                          </button>
                        </div>
                      ) : (
                        r.supplierPhone || "-"
                      )}
                    </td>

                    {/* 출고날짜(발송일) — production.actual_ship_date. poId가 있을 때만 편집 가능. */}
                    <td className="px-2 py-1.5">
                      {r.poId ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="date"
                            className={fieldCls(r, "shipDate", "w-28")}
                            title={fieldTitle(r, "shipDate")}
                            value={r._shipDateDraft}
                            onChange={(e) => updateDraft(r.rowKey, "_shipDateDraft", e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => saveShipDate(r)}
                            disabled={savingKey === `ship-${r.rowKey}`}
                            className={saveBtnCls}
                          >
                            저장
                          </button>
                        </div>
                      ) : (
                        r.shipDate || "-"
                      )}
                    </td>

                    <td className="px-2 py-1.5">
                      {r.poId ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            className={`${inputCls} w-20`}
                            value={r._outAmountDraft}
                            onChange={(e) => updateDraft(r.rowKey, "_outAmountDraft", e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => saveOutAmount(r)}
                            disabled={savingKey === `out-${r.rowKey}`}
                            className={saveBtnCls}
                          >
                            저장
                          </button>
                        </div>
                      ) : (
                        r.outAmount ? `${Number(r.outAmount).toLocaleString("ko-KR")}원` : "-"
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium">{wonWithVat(r.profit)}</td>
                    <td className="px-2 py-1.5 text-right text-neutral-500">{pct(r.marginRate)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
