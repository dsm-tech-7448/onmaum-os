"use client";

import type { QuoteItemDraft } from "@/lib/quotes/types";
import { blankItem, newUid } from "./item-rows-editor";

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
    const reader = new FileReader();
    reader.onload = () => update(uid, "imageDataUrl", reader.result as string);
    reader.readAsDataURL(file);
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
                <span>공급가 직접입력</span>
                <input
                  className={inputCls}
                  type="number"
                  placeholder="단가로 안 나누어떨어질 때만"
                  value={it.supplyOverride ?? ""}
                  onChange={(e) => update(it.uid, "supplyOverride", e.target.value)}
                  style={{ width: 150 }}
                />
                {it.supplyOverride && <span className="text-[#8E1F3B]">단가 대신 이 값을 공급가로 씁니다</span>}
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
