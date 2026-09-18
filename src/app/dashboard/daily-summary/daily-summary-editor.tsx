"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DailySummaryRow } from "@/lib/dashboard/daily-summary";
import { addDailySummaryEntry, updateDailySummaryEntry, deleteDailySummaryEntry } from "./actions";

function won(v: number | null): string {
  if (v == null) return "-";
  return `${Math.round(v).toLocaleString("ko-KR")}원`;
}

function pct(v: number | null): string {
  if (v == null) return "-";
  return `${(v * 100).toFixed(1)}%`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type Draft = {
  division: string;
  orderDate: string;
  contactName: string;
  customerName: string;
  contactOffice: string;
  contactMobile: string;
  productCode: string;
  productName: string;
  qty: string;
  reqDate: string;
  supplierName: string;
  supplierPhone: string;
  shipDate: string;
  note: string;
  paidCash: string;
  paidCard: string;
  outAmount: string;
  cashReceiptDate: string;
  taxInvoiceDate: string;
};

type EditableRow = DailySummaryRow & { draft: Draft; isNew: boolean; dirty: boolean };

function toDraft(r: DailySummaryRow): Draft {
  return {
    division: r.division,
    orderDate: r.orderDate,
    contactName: r.contactName,
    customerName: r.customerName,
    contactOffice: r.contactOffice,
    contactMobile: r.contactMobile,
    productCode: r.productCode,
    productName: r.productName,
    qty: r.qty,
    reqDate: r.reqDate,
    supplierName: r.supplierName,
    supplierPhone: r.supplierPhone,
    shipDate: r.shipDate,
    note: r.note,
    paidCash: r.paidCash != null ? String(r.paidCash) : "",
    paidCard: r.paidCard != null ? String(r.paidCard) : "",
    outAmount: r.outAmount != null ? String(r.outAmount) : "",
    cashReceiptDate: r.cashReceiptDate,
    taxInvoiceDate: r.taxInvoiceDate,
  };
}

function blankDraft(): Draft {
  return {
    division: "온마음기프트",
    orderDate: today(),
    contactName: "",
    customerName: "",
    contactOffice: "",
    contactMobile: "",
    productCode: "",
    productName: "",
    qty: "",
    reqDate: "",
    supplierName: "",
    supplierPhone: "",
    shipDate: "",
    note: "",
    paidCash: "",
    paidCard: "",
    outAmount: "",
    cashReceiptDate: "",
    taxInvoiceDate: "",
  };
}

function newLocalRow(): EditableRow {
  const draft = blankDraft();
  return {
    rowKey: `new-${crypto.randomUUID()}`,
    source: "manual",
    entryId: null,
    projectId: null,
    division: draft.division,
    orderDate: draft.orderDate,
    contactName: "",
    customerName: "",
    contactOffice: "",
    contactMobile: "",
    productCode: "",
    productName: "",
    qty: "",
    reqDate: "",
    supplierName: "",
    supplierPhone: "",
    shipDate: "",
    note: "",
    paidCash: null,
    paidCard: null,
    outAmount: null,
    cashReceiptDate: "",
    taxInvoiceDate: "",
    profit: null,
    marginRate: null,
    draft,
    isNew: true,
    dirty: true,
  };
}

const SOURCE_LABEL: Record<DailySummaryRow["source"], string> = {
  live: "실시간 연동",
  excel: "엑셀 이력",
  manual: "수기 입력",
};
const SOURCE_BADGE: Record<DailySummaryRow["source"], string> = {
  live: "bg-sky-100 text-sky-700",
  excel: "bg-neutral-200 text-neutral-600",
  manual: "bg-emerald-100 text-emerald-700",
};

function isShippingOverdue(r: DailySummaryRow): boolean {
  return !!r.reqDate && r.reqDate < today() && !r.shipDate;
}
function isPaymentPending(r: DailySummaryRow): boolean {
  return !!r.outAmount && r.paidCash == null && r.paidCard == null;
}

export function DailySummaryEditor({ initialRows }: { initialRows: DailySummaryRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<EditableRow[]>(() => initialRows.map((r) => ({ ...r, draft: toDraft(r), isNew: false, dirty: false })));
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<Record<DailySummaryRow["source"], boolean>>({
    live: true,
    excel: true,
    manual: true,
  });
  const [savingKey, setSavingKey] = useState<string | null>(null);

  function updateDraft(rowKey: string, field: keyof Draft, value: string) {
    setRows((rs) => rs.map((r) => (r.rowKey === rowKey ? { ...r, draft: { ...r.draft, [field]: value }, dirty: true } : r)));
  }

  function addRow() {
    setRows((rs) => [newLocalRow(), ...rs]);
  }

  async function saveRow(row: EditableRow) {
    setSavingKey(row.rowKey);
    try {
      if (row.isNew) {
        const created = await addDailySummaryEntry(row.draft);
        setRows((rs) =>
          rs.map((r) =>
            r.rowKey === row.rowKey
              ? { ...r, rowKey: `entry-${created.id}`, entryId: created.id, isNew: false, dirty: false }
              : r
          )
        );
      } else if (row.entryId) {
        await updateDailySummaryEntry(row.entryId, row.draft);
        setRows((rs) => rs.map((r) => (r.rowKey === row.rowKey ? { ...r, dirty: false } : r)));
      }
      router.refresh();
    } finally {
      setSavingKey(null);
    }
  }

  async function removeRow(row: EditableRow) {
    if (row.isNew) {
      setRows((rs) => rs.filter((r) => r.rowKey !== row.rowKey));
      return;
    }
    if (!row.entryId) return;
    if (!confirm("이 행을 삭제할까요? 되돌릴 수 없습니다.")) return;
    setSavingKey(row.rowKey);
    try {
      await deleteDailySummaryEntry(row.entryId);
      setRows((rs) => rs.filter((r) => r.rowKey !== row.rowKey));
      router.refresh();
    } finally {
      setSavingKey(null);
    }
  }

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!sourceFilter[r.source]) return false;
      if (!q) return true;
      const hay = `${r.customerName} ${r.contactName} ${r.productName} ${r.productCode} ${r.supplierName}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query, sourceFilter]);

  const stats = useMemo(() => {
    const liveCount = rows.filter((r) => r.source === "live").length;
    const excelCount = rows.filter((r) => r.source === "excel").length;
    const manualCount = rows.filter((r) => r.source === "manual").length;
    const overdue = visibleRows.filter(isShippingOverdue).length;
    const pendingPay = visibleRows.filter(isPaymentPending).length;
    const revenueSum = visibleRows.reduce((s, r) => s + (r.paidCash ?? 0) + (r.paidCard ?? 0), 0);
    const costSum = visibleRows.reduce((s, r) => s + (r.outAmount ?? 0), 0);
    const profitSum = revenueSum - costSum;
    return { liveCount, excelCount, manualCount, overdue, pendingPay, revenueSum, costSum, profitSum };
  }, [rows, visibleRows]);

  const th = "h-9 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-neutral-500 sticky top-0 z-20 font-semibold";
  const thGroup = "h-8 border-b border-neutral-100 bg-neutral-50 px-3 py-1.5 text-neutral-400 sticky top-9 z-20";
  const thCorner = "h-9 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-neutral-500 sticky top-0 left-0 z-30 font-semibold";
  const inputCls = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
  const saveBtnCls = "shrink-0 rounded bg-neutral-800 px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50";

  function rowBg(r: EditableRow): string {
    if (r.isNew) return "bg-emerald-50/70";
    if (isShippingOverdue(r)) return "bg-rose-50";
    if (isPaymentPending(r)) return "bg-amber-50";
    return "";
  }
  function firstColBg(r: EditableRow): string {
    if (r.isNew) return "bg-emerald-50";
    if (isShippingOverdue(r)) return "bg-rose-50";
    if (isPaymentPending(r)) return "bg-amber-50";
    return "bg-white";
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-[1700px]">
        <div className="mb-6">
          <Link href="/dashboard" className="text-sm text-neutral-500 hover:underline">
            ← 대시보드
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-neutral-900">Daily Summary</h1>
          <p className="mt-1 text-sm text-neutral-500">
            매일 쓰던 Daily Summary 엑셀을 컬럼 그대로 옮긴 화면입니다.{" "}
            <span className="rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-700">실시간 연동</span> 행은
            ONMAUM-OS의 견적·발주·거래명세서에서 자동으로 채워져 읽기 전용이고,{" "}
            <span className="rounded bg-neutral-200 px-1.5 py-0.5 font-medium text-neutral-600">엑셀 이력</span> /{" "}
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700">수기 입력</span> 행은
            이 화면에서 바로 고치거나 새로 추가할 수 있습니다.
          </p>
        </div>

        {/* 요약 카드 — 한눈에 상태 파악 */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <StatCard label="실시간 연동" value={`${stats.liveCount}건`} tone="bg-sky-50 text-sky-700" />
          <StatCard label="엑셀 이력" value={`${stats.excelCount}건`} tone="bg-neutral-100 text-neutral-600" />
          <StatCard label="수기 입력" value={`${stats.manualCount}건`} tone="bg-emerald-50 text-emerald-700" />
          <StatCard label="출고 지연" value={`${stats.overdue}건`} tone="bg-rose-50 text-rose-700" emphasize={stats.overdue > 0} />
          <StatCard label="입금 확인 필요" value={`${stats.pendingPay}건`} tone="bg-amber-50 text-amber-700" emphasize={stats.pendingPay > 0} />
          <StatCard label="매출이익 합계" value={won(stats.profitSum)} tone="bg-indigo-50 text-indigo-700" />
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="기관명·담당자·상품명·공급업체 검색..."
              className="w-64 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {(["live", "excel", "manual"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSourceFilter((f) => ({ ...f, [s]: !f[s] }))}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  sourceFilter[s] ? SOURCE_BADGE[s] : "bg-neutral-100 text-neutral-400 line-through"
                }`}
              >
                {SOURCE_LABEL[s]}
              </button>
            ))}
          </div>
          <button type="button" onClick={addRow} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
            + 새 행 추가
          </button>
        </div>

        <div className="max-h-[75vh] overflow-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full whitespace-nowrap text-sm">
            <thead>
              <tr className="text-left">
                <th rowSpan={2} className={thCorner}>날짜</th>
                <th rowSpan={2} className={th}>구분</th>
                <th rowSpan={2} className={th}>이름</th>
                <th rowSpan={2} className={th}>기관명</th>
                <th colSpan={2} className={`${th} text-center`}>연락처</th>
                <th rowSpan={2} className={th}>제품코드</th>
                <th rowSpan={2} className={th}>제품명</th>
                <th rowSpan={2} className={`${th} text-right`}>필요수량</th>
                <th rowSpan={2} className={th}>요청날짜</th>
                <th rowSpan={2} className={th}>공급업체</th>
                <th rowSpan={2} className={th}>전화번호</th>
                <th rowSpan={2} className={th}>출고날짜</th>
                <th rowSpan={2} className={th}>특기사항</th>
                <th colSpan={2} className={`${th} text-center`}>결제</th>
                <th rowSpan={2} className={`${th} text-right`}>출금</th>
                <th colSpan={2} className={`${th} text-center`}>영수증</th>
                <th rowSpan={2} className={`${th} text-right`}>매출이익</th>
                <th rowSpan={2} className={`${th} text-right`}>마진율</th>
                <th rowSpan={2} className={th}></th>
              </tr>
              <tr className="text-left">
                <th className={thGroup}>Office</th>
                <th className={thGroup}>Mobile</th>
                <th className={thGroup}>현금</th>
                <th className={thGroup}>카드</th>
                <th className={thGroup}>현금영수증</th>
                <th className={thGroup}>세금계산서</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={22} className="px-3 py-8 text-center text-neutral-400">
                    표시할 행이 없습니다.
                  </td>
                </tr>
              ) : (
                visibleRows.map((r) => {
                  const editable = r.source !== "live";
                  return (
                    <tr key={r.rowKey} className={`border-b border-neutral-100 last:border-0 hover:bg-neutral-50/80 ${rowBg(r)}`}>
                      <td className={`sticky left-0 z-10 px-3 py-2 ${firstColBg(r)}`}>
                        {editable ? (
                          <input type="date" className={inputCls} value={r.draft.orderDate} onChange={(e) => updateDraft(r.rowKey, "orderDate", e.target.value)} />
                        ) : (
                          r.orderDate || "-"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_BADGE[r.source]}`}>{SOURCE_LABEL[r.source]}</span>
                        {editable ? (
                          <input type="text" className={inputCls} value={r.draft.division} onChange={(e) => updateDraft(r.rowKey, "division", e.target.value)} />
                        ) : (
                          <div>{r.division || "-"}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <input type="text" className={inputCls} value={r.draft.contactName} onChange={(e) => updateDraft(r.rowKey, "contactName", e.target.value)} />
                        ) : (
                          r.contactName || "-"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <input type="text" className={inputCls} value={r.draft.customerName} onChange={(e) => updateDraft(r.rowKey, "customerName", e.target.value)} />
                        ) : r.projectId ? (
                          <Link href={`/projects/${r.projectId}`} className="text-neutral-800 hover:underline">
                            {r.customerName}
                          </Link>
                        ) : (
                          r.customerName || "-"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <input type="text" className={inputCls} value={r.draft.contactOffice} onChange={(e) => updateDraft(r.rowKey, "contactOffice", e.target.value)} />
                        ) : (
                          r.contactOffice || "-"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <input type="text" className={inputCls} value={r.draft.contactMobile} onChange={(e) => updateDraft(r.rowKey, "contactMobile", e.target.value)} />
                        ) : (
                          r.contactMobile || "-"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <input type="text" className={inputCls} value={r.draft.productCode} onChange={(e) => updateDraft(r.rowKey, "productCode", e.target.value)} />
                        ) : (
                          r.productCode || "-"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <input type="text" className={`${inputCls} min-w-[160px]`} value={r.draft.productName} onChange={(e) => updateDraft(r.rowKey, "productName", e.target.value)} />
                        ) : (
                          r.productName || "-"
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {editable ? (
                          <input type="number" className={`${inputCls} w-20`} value={r.draft.qty} onChange={(e) => updateDraft(r.rowKey, "qty", e.target.value)} />
                        ) : (
                          r.qty || "-"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <input type="date" className={inputCls} value={r.draft.reqDate} onChange={(e) => updateDraft(r.rowKey, "reqDate", e.target.value)} />
                        ) : (
                          r.reqDate || "-"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <input type="text" className={inputCls} value={r.draft.supplierName} onChange={(e) => updateDraft(r.rowKey, "supplierName", e.target.value)} />
                        ) : (
                          r.supplierName || "-"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <input type="text" className={inputCls} value={r.draft.supplierPhone} onChange={(e) => updateDraft(r.rowKey, "supplierPhone", e.target.value)} />
                        ) : (
                          r.supplierPhone || "-"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <input type="date" className={inputCls} value={r.draft.shipDate} onChange={(e) => updateDraft(r.rowKey, "shipDate", e.target.value)} />
                        ) : (
                          r.shipDate || "-"
                        )}
                        {isShippingOverdue(r) && <div className="mt-0.5 text-[10px] font-medium text-rose-600">지연</div>}
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <input type="text" className={`${inputCls} min-w-[120px]`} value={r.draft.note} onChange={(e) => updateDraft(r.rowKey, "note", e.target.value)} />
                        ) : (
                          r.note || "-"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <input type="number" className={`${inputCls} w-24`} value={r.draft.paidCash} onChange={(e) => updateDraft(r.rowKey, "paidCash", e.target.value)} />
                        ) : (
                          won(r.paidCash)
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <input type="number" className={`${inputCls} w-24`} value={r.draft.paidCard} onChange={(e) => updateDraft(r.rowKey, "paidCard", e.target.value)} />
                        ) : (
                          won(r.paidCard)
                        )}
                        {isPaymentPending(r) && <div className="mt-0.5 text-[10px] font-medium text-amber-600">입금 확인 필요</div>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {editable ? (
                          <input type="number" className={`${inputCls} w-24`} value={r.draft.outAmount} onChange={(e) => updateDraft(r.rowKey, "outAmount", e.target.value)} />
                        ) : (
                          won(r.outAmount)
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <input type="date" className={inputCls} value={r.draft.cashReceiptDate} onChange={(e) => updateDraft(r.rowKey, "cashReceiptDate", e.target.value)} />
                        ) : (
                          r.cashReceiptDate || "-"
                        )}
                      </td>
                      <td className="px-3 py-2 text-neutral-600">
                        {editable ? (
                          <input type="date" className={inputCls} value={r.draft.taxInvoiceDate} onChange={(e) => updateDraft(r.rowKey, "taxInvoiceDate", e.target.value)} />
                        ) : (
                          r.taxInvoiceDate || "-"
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-neutral-900">{won(r.profit)}</td>
                      <td className="px-3 py-2 text-right text-neutral-500">{pct(r.marginRate)}</td>
                      <td className="px-3 py-2">
                        {editable && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => saveRow(r)}
                              disabled={savingKey === r.rowKey || !r.dirty}
                              className={saveBtnCls}
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              onClick={() => removeRow(r)}
                              disabled={savingKey === r.rowKey}
                              className="shrink-0 rounded border border-rose-200 px-2 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                            >
                              삭제
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function StatCard({ label, value, tone, emphasize }: { label: string; value: string; tone: string; emphasize?: boolean }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${tone} ${emphasize ? "ring-2 ring-offset-1 ring-current" : ""}`}>
      <div className="text-xs font-medium opacity-70">{label}</div>
      <div className="mt-0.5 text-lg font-bold">{value}</div>
    </div>
  );
}
