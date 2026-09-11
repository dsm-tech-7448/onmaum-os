"use client";

import type { QuoteItemDraft, QuoteTierDraft } from "@/lib/quotes/types";
import { blankItem, newUid } from "./item-rows-editor";

const inputCls =
  "rounded border border-neutral-300 px-1.5 py-1 text-[11px] outline-none focus:border-neutral-900";

export function newTier(preset?: Partial<QuoteItemDraft>[]): QuoteTierDraft {
  const items = (preset ?? [blankItem("product")]).map((p) => ({ ...blankItem(p.lineType ?? "product"), ...p }));
  return { uid: newUid(), items };
}

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
    >
      {value === "product" ? "품목" : "옵션"}
    </button>
  );
}

export function TierEditor({
  tiers,
  onChange,
  productNames,
  optionNames,
  listId,
}: {
  tiers: QuoteTierDraft[];
  onChange: (tiers: QuoteTierDraft[]) => void;
  productNames: string[];
  optionNames: string[];
  listId: string;
}) {
  function updateTierItems(tuid: string, items: QuoteItemDraft[]) {
    onChange(tiers.map((t) => (t.uid === tuid ? { ...t, items } : t)));
  }
  function removeTier(tuid: string) {
    onChange(tiers.filter((t) => t.uid !== tuid));
  }
  function moveTier(tuid: string, dir: -1 | 1) {
    const idx = tiers.findIndex((t) => t.uid === tuid);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= tiers.length) return;
    const next = [...tiers];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    onChange(next);
  }
  function addTier() {
    onChange([...tiers, newTier()]);
  }

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

      {tiers.map((tier, ti) => {
        const items = tier.items;
        function update(uid: string, field: keyof QuoteItemDraft, value: string) {
          updateTierItems(
            tier.uid,
            items.map((it) => (it.uid === uid ? { ...it, [field]: value } : it))
          );
        }
        function remove(uid: string) {
          updateTierItems(tier.uid, items.filter((it) => it.uid !== uid));
        }
        function move(uid: string, dir: -1 | 1) {
          const idx = items.findIndex((it) => it.uid === uid);
          const swapIdx = idx + dir;
          if (swapIdx < 0 || swapIdx >= items.length) return;
          const next = [...items];
          [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
          updateTierItems(tier.uid, next);
        }
        function addItem() {
          updateTierItems(tier.uid, [...items, blankItem("option")]);
        }
        function handleImageUpload(uid: string, file: File | undefined) {
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => update(uid, "imageDataUrl", reader.result as string);
          reader.readAsDataURL(file);
        }

        return (
          <div key={tier.uid} className="mb-2.5 rounded-md border border-[#e2c5cf] bg-[#fdf7f9] p-2.5">
            <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-[#8E1F3B]">
              <span>구간 {ti + 1}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => moveTier(tier.uid, -1)} className="text-[11px]">
                  ▲
                </button>
                <button type="button" onClick={() => moveTier(tier.uid, 1)} className="text-[11px]">
                  ▼
                </button>
                <button type="button" onClick={() => removeTier(tier.uid)} className="text-[11px] text-red-600">
                  구간 삭제 ×
                </button>
              </div>
            </div>

            <div
              className="mb-1 grid gap-1 text-[9px] text-neutral-400"
              style={{ gridTemplateColumns: "44px 1fr 46px 55px 62px 44px" }}
            >
              <div>구분</div>
              <div>품명/옵션명</div>
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
                    style={{ gridTemplateColumns: "44px 1fr 46px 55px 62px 44px" }}
                  >
                    <TypeToggle value={it.lineType} onChange={(v) => update(it.uid, "lineType", v)} />
                    <input
                      className={inputCls}
                      list={it.lineType === "product" ? productListId : optionListId}
                      placeholder="품명/옵션명"
                      value={it.name}
                      onChange={(e) => update(it.uid, "name", e.target.value)}
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
                        className="rounded border border-neutral-300 px-1 text-[9px] text-[#8E1F3B]"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => move(it.uid, 1)}
                        className="rounded border border-neutral-300 px-1 text-[9px] text-[#8E1F3B]"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(it.uid)}
                        className="rounded border border-neutral-300 px-1 text-[9px] text-red-600"
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
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addItem}
              className="mt-1.5 rounded bg-neutral-600 px-2 py-1 text-[10.5px] text-white"
            >
              + 이 구간에 옵션 줄 추가
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addTier}
        className="rounded-md bg-[#8E1F3B] px-3 py-1.5 text-xs text-white"
      >
        + 수량 구간 추가
      </button>
    </div>
  );
}
