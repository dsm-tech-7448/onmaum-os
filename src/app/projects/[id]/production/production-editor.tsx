"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ImportablePurchaseOrder,
  ProductionDraft,
  ProductionSummary,
  NotificationLogSummary,
} from "@/lib/production/types";
import { listImportablePurchaseOrders, listNotifications, listProduction, saveProduction } from "./actions";

const CHANNEL_LABEL: Record<string, string> = {
  kakao: "카카오알림톡",
  sms: "문자",
  internal: "내부알림",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "생성됨 (미발송)",
  sent: "발송완료",
  failed: "발송실패",
};

function blankDraft(): ProductionDraft {
  return {
    id: null,
    poId: null,
    carrier: "",
    trackingNumber: "",
    actualShipDate: "",
    note: "",
  };
}

export function ProductionEditor({
  projectId,
  initialBatches,
  initialImportablePOs,
  initialNotifications,
}: {
  projectId: string;
  initialBatches: ProductionSummary[];
  initialImportablePOs: ImportablePurchaseOrder[];
  initialNotifications: NotificationLogSummary[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ProductionDraft>(blankDraft());
  const [batches, setBatches] = useState<ProductionSummary[]>(initialBatches);
  const [importablePOs, setImportablePOs] = useState<ImportablePurchaseOrder[]>(initialImportablePOs);
  const [selectedPO, setSelectedPO] = useState<ImportablePurchaseOrder | null>(null);
  const [notifications, setNotifications] = useState<NotificationLogSummary[]>(initialNotifications);
  const [isSaving, setIsSaving] = useState(false);
  const [saveHint, setSaveHint] = useState("");
  const [saveError, setSaveError] = useState("");

  function set<K extends keyof ProductionDraft>(key: K, value: ProductionDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function handlePickPO(po: ImportablePurchaseOrder) {
    setSelectedPO(po);
    set("poId", po.id);
  }

  function handleEdit(batch: ProductionSummary) {
    setDraft({
      id: batch.id,
      poId: batch.poId,
      carrier: batch.carrier ?? "",
      trackingNumber: batch.trackingNumber ?? "",
      actualShipDate: batch.actualShipDate ?? "",
      note: batch.note ?? "",
    });
    setSelectedPO(
      batch.poId && batch.poNumber
        ? { id: batch.poId, poNumber: batch.poNumber, latestRevision: 0, supplierName: batch.supplierName ?? "", reqDate: batch.reqDate }
        : null
    );
    setSaveHint("");
    setSaveError("");
  }

  function handleNewBatch() {
    setDraft(blankDraft());
    setSelectedPO(null);
    setSaveHint("");
    setSaveError("");
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError("");
    try {
      const result = await saveProduction(projectId, draft);
      const [nextBatches, nextImportablePOs, nextNotifications] = await Promise.all([
        listProduction(projectId),
        listImportablePurchaseOrders(projectId),
        listNotifications(projectId),
      ]);
      setBatches(nextBatches);
      setImportablePOs(nextImportablePOs);
      setNotifications(nextNotifications);
      setDraft((d) => ({ ...d, id: result.id }));
      setSaveHint(
        result.notified
          ? "저장됨 — 송장번호가 처음 등록되어 배송일정안내 알림이 생성되고 프로젝트가 8단계로 전환됐습니다."
          : "저장됨."
      );
      if (result.notified) router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex items-start gap-6">
      <div className="w-[440px] shrink-0 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-neutral-900">제작·배송 현황</h2>
        <p className="mb-4 text-xs text-neutral-500">
          발주서에 적힌 발송요청일에 공급업체가 실제로 보냈는지 확인하고, 업체가 알려준 송장번호를
          입력하세요. 송장번호를 처음 입력하는 순간에만 배송일정안내 알림이 자동 생성되고 프로젝트가
          &ldquo;8. 배송일정 안내&rdquo;로 전환됩니다 — 세금계산서 발행이 끝나야 가능합니다.
        </p>

        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs font-medium text-neutral-700">
            {draft.id ? "배송건 수정" : "새 배송건"}
          </label>
          {draft.id && (
            <button type="button" onClick={handleNewBatch} className="text-[11px] text-neutral-500 underline">
              + 새 배송건 추가
            </button>
          )}
        </div>

        <div className="mb-4 rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3">
          <label className="mb-1 block text-xs font-medium text-neutral-700">어느 발주서에 대한 배송인가요?</label>
          {selectedPO ? (
            <div className="rounded-md bg-white px-2.5 py-2 text-xs">
              <div className="flex items-center justify-between">
                <span>
                  <span className="mr-1 font-bold text-[#8E1F3B]">{selectedPO.poNumber}</span>
                  {selectedPO.supplierName || "(공급업체 미입력)"}
                </span>
                {!draft.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPO(null);
                      set("poId", null);
                    }}
                    className="text-[11px] text-neutral-500 underline"
                  >
                    변경
                  </button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">
                발송요청일: {selectedPO.reqDate || "미입력"}
              </p>
            </div>
          ) : importablePOs.length === 0 ? (
            <p className="text-[11px] text-neutral-400">아직 배송건이 안 붙은 발주서가 없습니다.</p>
          ) : (
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {importablePOs.map((po) => (
                <div
                  key={po.id}
                  className="flex items-center justify-between rounded-md bg-white px-2.5 py-1.5 text-[11px]"
                >
                  <span>
                    <span className="mr-1.5 font-bold text-[#8E1F3B]">{po.poNumber}</span>
                    {po.supplierName || "(공급업체 미입력)"} · 발송요청일 {po.reqDate || "미입력"}
                  </span>
                  <button
                    type="button"
                    onClick={() => handlePickPO(po)}
                    className="rounded bg-[#8E1F3B] px-2 py-0.5 text-white"
                  >
                    불러오기
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mb-3 flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-700">택배사</label>
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              value={draft.carrier}
              onChange={(e) => set("carrier", e.target.value)}
              placeholder="예: CJ대한통운"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-700">송장번호</label>
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              value={draft.trackingNumber}
              onChange={(e) => set("trackingNumber", e.target.value)}
            />
          </div>
        </div>

        <label className="mb-1 block text-xs font-medium text-neutral-700">발송 확인일</label>
        <input
          type="date"
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          value={draft.actualShipDate}
          onChange={(e) => set("actualShipDate", e.target.value)}
        />

        <label className="mb-1 block text-xs font-medium text-neutral-700">메모</label>
        <textarea
          rows={2}
          className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-xs"
          value={draft.note}
          onChange={(e) => set("note", e.target.value)}
        />

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !draft.poId}
          className="mb-1 w-full rounded-md bg-[#2f7a4a] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {isSaving ? "저장 중..." : "💾 저장"}
        </button>
        {!draft.poId && <p className="mt-1 text-[11px] text-red-600">먼저 위에서 발주서를 불러와야 저장할 수 있습니다.</p>}
        {saveHint && <p className="text-[11px] text-neutral-500">{saveHint}</p>}
        {saveError && <p className="rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-600">{saveError}</p>}
      </div>

      <div className="flex-1">
        <h3 className="mb-2 text-sm font-semibold text-neutral-900">배송건 목록</h3>
        {batches.length === 0 ? (
          <p className="mb-6 text-sm text-neutral-400">아직 등록된 배송건이 없습니다.</p>
        ) : (
          <div className="mb-6 flex flex-col gap-2">
            {batches.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => handleEdit(b)}
                className="rounded-xl border border-neutral-200 bg-white p-3 text-left text-sm hover:border-neutral-300"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-neutral-900">
                    {b.poNumber ?? "(발주서 미연결)"}
                    {b.trackingNumber && (
                      <span className="ml-1.5 rounded-full bg-green-100 px-2 py-0.5 text-[10px] text-green-700">
                        송장 등록됨
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {new Date(b.updatedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit" })}
                  </span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {b.supplierName || "공급업체 미입력"} · 발송요청일 {b.reqDate || "미입력"}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  {b.carrier || "택배사 미입력"} {b.trackingNumber ? `· ${b.trackingNumber}` : "· 송장번호 미입력"}
                </p>
              </button>
            ))}
          </div>
        )}

        <h3 className="mb-2 text-sm font-semibold text-neutral-900">알림 로그</h3>
        {notifications.length === 0 ? (
          <p className="text-sm text-neutral-400">아직 생성된 알림이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {notifications.map((n) => (
              <div key={n.id} className="rounded-xl border border-neutral-200 bg-white p-3 text-sm">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded-full bg-[#f7eef1] px-2 py-0.5 text-[11px] font-medium text-[#8E1F3B]">
                    {n.type}
                  </span>
                  <span className="text-[11px] text-neutral-400">
                    {CHANNEL_LABEL[n.channel] ?? n.channel} · {STATUS_LABEL[n.status] ?? n.status}
                  </span>
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
