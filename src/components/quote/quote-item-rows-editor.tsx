"use client";

import { useState } from "react";
import type { QuoteItemDraft } from "@/lib/quotes/types";
import { blankItem, newUid } from "./item-rows-editor";
import { resizeImageToDataUrl } from "@/lib/images/resize-image";

// item-rows-editor.tsx의 포크 — 발주서/거래명세서/세금계산서도 그 컴포넌트를 그대로 재사용하는데
// "품목별 이미지"는 견적서에만 필요한 기능이라 공용 컴포넌트를 건드리지 않고 견적서 전용으로
// 따로 둔다. "품목"(product) 줄에만 이미지 업로드를 붙인다 — 옵션 줄엔 이미지가 필요 없어서.

const inputCls =
  "rounded border border-neutral-300 px-1.5 py-1 text-[11px] outline-none focus:border-neutral-900";

function TypeToggle({
  value,
  onChange,
}: {
  value: QuoteItemDraft["lineType"];
  onChange: (v: QuoteItemDraft["lineType"]) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(value === "product" ? "option" : "product")}
      className={`rounded px-1.5 py-1 text-[10px] font-medium ${
        value === "product" ? "bg-[#8E1F3B] text-white" : "bg-neutral-200 text-neutral-600"
      }`}
      title="클릭해서 품목/옵션 전환"
    >
      {value === "product" ? "품목" : "옵션"}
    </button>
  );
}

export function QuoteItemRowsEditor({
  items,
  onChange,
  productNames,
  optionNames,
  listId,
}: {
  items: QuoteItemDraft[];
  onChange: (items: QuoteItemDraft[]) => void;
  productNames: string[];
  optionNames: string[];
  listId: string;
}) {
  function update(uid: string, field: keyof QuoteItemDraft, value: string) {
    onChange(items.map((it) => (it.uid === uid ? { ...it, [field]: value } : it)));
  }
  function patch(uid: string, partial: Partial<QuoteItemDraft>) {
    onChange(items.map((it) => (it.uid === uid ? { ...it, ...partial } : it)));
  }

  // 통합비용(2026-10-19) — 기본 수량에 못 미쳐 수량×단가로 매기지 않고 한 줄 금액으로 받는 경우.
  // 켜면 단가를 비우고(견적서에 "-"로 표시) 금액만 입력받는다. 수량은 계속 입력할 수 있다
  // (2026-10-23: 통합비용 줄에도 수량을 적어 달라는 요청) — 금액 계산에는 쓰이지 않고 견적서에
  // 표시만 된다. 저장 값은 기존 supplyOverride(공급가 직접입력)를 그대로 쓰므로 거래명세서/
  // 세금계산서까지 그대로 이어진다. 이번 화면에서 직접 켠 줄만 단가 입력을 잠그고, 이미 저장된 줄
  // (공급가 직접입력 값 있음)은 체크만 켜진 채 단가도 그대로 고칠 수 있다.
  const [lumpUids, setLumpUids] = useState<Set<string>>(new Set());
  function toggleLump(it: QuoteItemDraft, on: boolean) {
    setLumpUids((prev) => {
      const next = new Set(prev);
      if (on) next.add(it.uid);
      else next.delete(it.uid);
      return next;
    });
    if (on) patch(it.uid, { price: "" });
    else patch(it.uid, { supplyOverride: "" });
  }
  function remove(uid: string) {
    onChange(items.filter((it) => it.uid !== uid));
  }
  function move(uid: string, dir: -1 | 1) {
    const idx = items.findIndex((it) => it.uid === uid);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const next = [...items];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    onChange(next);
  }
  function add() {
    onChange([...items, blankItem(items.length === 0 ? "product" : "option")]);
  }
  function handleImageUpload(uid: string, file: File | undefined) {
    if (!file) return;
    resizeImageToDataUrl(file).then((imageDataUrl) => update(uid, "imageDataUrl", imageDataUrl));
  }

  const columnWidths = "44px 56px 140px 60px 40px 50px 64px 60px";

  const productListId = `${listId}-product`;
  const optionListId = `${listId}-option`;

  return (
    <div>
      {/* 품목/옵션 자동완성을 분리한다(2026-09-10) — 하나의 목록을 같이 쓰면 옵션 칸에
          상품명이, 품목 칸에 옵션명이 섞여 나온다. */}
      <datalist id={productListId}>
        {productNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <datalist id={optionListId}>
        {optionNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <div className="overflow-x-auto">
        <div
          className="mb-1 grid gap-1 text-[9px] text-neutral-400"
          style={{ gridTemplateColumns: columnWidths, minWidth: "max-content" }}
        >
          <div>구분</div>
          <div>코드</div>
          <div>품명/옵션명</div>
          <div>규격</div>
          <div>단위</div>
          <div>수량</div>
          <div>단가</div>
          <div />
        </div>

        <div className="flex flex-col gap-1.5">
          {items.map((it) => (
            <div key={it.uid} className="flex flex-col gap-1">
              <div
                className="grid items-center gap-1"
                style={{ gridTemplateColumns: columnWidths, minWidth: "max-content" }}
              >
                <TypeToggle value={it.lineType} onChange={(v) => update(it.uid, "lineType", v)} />
                <input
                  className={inputCls}
                  placeholder="코드"
                  value={it.code}
                  onChange={(e) => update(it.uid, "code", e.target.value)}
                />
                <input
                  className={inputCls}
                  list={it.lineType === "product" ? productListId : optionListId}
                  placeholder="품명/옵션명"
                  value={it.name}
                  onChange={(e) => update(it.uid, "name", e.target.value)}
                />
                <input
                  className={inputCls}
                  placeholder="규격"
                  value={it.spec}
                  onChange={(e) => update(it.uid, "spec", e.target.value)}
                />
                <input
                  className={inputCls}
                  placeholder="단위"
                  value={it.unit}
                  onChange={(e) => update(it.uid, "unit", e.target.value)}
                />
                <input
                  className={inputCls}
                  type="number"
                  placeholder="수량"
                  value={it.qty}
                  onChange={(e) => update(it.uid, "qty", e.target.value)}
                />
                <input
                  className={inputCls}
                  type="number"
                  placeholder="단가"
                  value={it.price}
                  disabled={lumpUids.has(it.uid)}
                  onChange={(e) => update(it.uid, "price", e.target.value)}
                />
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    onClick={() => move(it.uid, -1)}
                    className="rounded border border-neutral-300 px-1 text-[10px] text-[#8E1F3B]"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => move(it.uid, 1)}
                    className="rounded border border-neutral-300 px-1 text-[10px] text-[#8E1F3B]"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(it.uid)}
                    className="rounded border border-neutral-300 px-1 text-[10px] text-red-600"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="ml-[48px] flex items-center gap-2">
                {it.imageDataUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={it.imageDataUrl}
                      alt={`${it.name || (it.lineType === "product" ? "품목" : "옵션")} 이미지 미리보기`}
                      className="h-10 w-10 rounded border border-neutral-300 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => update(it.uid, "imageDataUrl", "")}
                      className="text-[10px] text-red-600 underline"
                    >
                      이미지 제거
                    </button>
                  </>
                ) : (
                  <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-neutral-500">
                    <span className="rounded border border-dashed border-neutral-300 bg-neutral-50 px-2 py-1 text-neutral-500 hover:border-[#8E1F3B] hover:text-[#8E1F3B]">
                      📷 이 줄 이미지 추가
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleImageUpload(it.uid, e.target.files?.[0])}
                    />
                  </label>
                )}
              </div>

              <div className="ml-[48px] flex items-center gap-1.5 text-[10px] text-neutral-500">
                <span>대체 상품코드</span>
                <input
                  className={inputCls}
                  placeholder="내부용 — 고객 문서에 표시 안 됨"
                  value={it.altCode ?? ""}
                  onChange={(e) => update(it.uid, "altCode", e.target.value)}
                  style={{ width: 200 }}
                />
                <span className="rounded bg-neutral-100 px-1 py-0.5 text-neutral-400">내부용</span>
              </div>

              <div className="ml-[48px] flex items-center gap-1.5 text-[10px] text-neutral-500">
                <label className="flex cursor-pointer items-center gap-1">
                  <input
                    type="checkbox"
                    className="h-3 w-3"
                    checked={lumpUids.has(it.uid) || !!it.supplyOverride}
                    onChange={(e) => toggleLump(it, e.target.checked)}
                  />
                  <span>통합비용 (단가 대신 금액 직접입력, 수량은 표시용)</span>
                </label>
                {(lumpUids.has(it.uid) || !!it.supplyOverride) && (
                  <input
                    className={inputCls}
                    type="number"
                    placeholder="공급가 금액"
                    value={it.supplyOverride ?? ""}
                    onChange={(e) => update(it.uid, "supplyOverride", e.target.value)}
                    style={{ width: 110 }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-2 rounded-md bg-[#8E1F3B] px-3 py-1.5 text-xs text-white"
      >
        + 품목/옵션 줄 추가
      </button>
    </div>
  );
}
