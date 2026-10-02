"use client";

import { useEffect, useRef, useState } from "react";

type SupplierResult = {
  id: string;
  companyName: string;
  phone: string | null;
  productCategory: string | null;
};

/**
 * suppliers에서 검색해 선택하거나, 매칭되는 게 없으면 입력한 텍스트가 그대로
 * 새 업체명(자유 입력)으로 쓰인다 — supplierId는 그 경우 null.
 */
export function SupplierSearch({
  supplierId,
  supplierName,
  onChange,
}: {
  supplierId: string | null;
  supplierName: string;
  onChange: (v: { supplierId: string | null; supplierName: string; supplierPhone?: string }) => void;
}) {
  const [results, setResults] = useState<SupplierResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (supplierId || supplierName.trim().length === 0) {
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/suppliers/search?q=${encodeURIComponent(supplierName.trim())}`);
      if (!res.ok) return;
      const data = (await res.json()) as { results: SupplierResult[] };
      setResults(data.results);
      setIsOpen(true);
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [supplierName, supplierId]);

  function handleSelect(s: SupplierResult) {
    setIsOpen(false);
    onChange({ supplierId: s.id, supplierName: s.companyName, supplierPhone: s.phone ?? "" });
  }

  function handleClear() {
    setIsOpen(false);
    onChange({ supplierId: null, supplierName: "" });
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          type="text"
          value={supplierName}
          onChange={(e) => onChange({ supplierId: null, supplierName: e.target.value })}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="공급업체명 검색 또는 새 업체명 입력"
          autoComplete="off"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
        />
        {supplierName && (
          <button
            type="button"
            onClick={handleClear}
            className="shrink-0 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-100"
          >
            지우기
          </button>
        )}
      </div>

      {supplierId && <p className="mt-1.5 text-xs text-neutral-500">기존 공급업체에서 선택됨</p>}
      {!supplierId && supplierName.trim() !== "" && (
        <p className="mt-1.5 text-xs text-neutral-400">새 업체명으로 입력 중 (suppliers에 없는 이름)</p>
      )}

      {isOpen && !supplierId && results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg">
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => handleSelect(s)}
                className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-neutral-50"
              >
                <span className="font-medium text-neutral-900">{s.companyName}</span>
                <span className="text-xs text-neutral-500">
                  {s.phone ?? "전화 미상"}
                  {s.productCategory ? ` · ${s.productCategory}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
