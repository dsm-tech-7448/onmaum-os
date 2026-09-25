"use client";

import { useEffect, useRef, useState } from "react";
import { createCustomerQuick } from "./actions";

type CustomerResult = {
  id: string;
  companyName: string;
  contactName: string | null;
  customerGrade: string | null;
};

export function CustomerSearch({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (customer: CustomerResult | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<CustomerResult | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (selected || query.trim().length === 0) {
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/customers/search?q=${encodeURIComponent(query.trim())}`);
      if (!res.ok) return;
      const data = (await res.json()) as { results: CustomerResult[] };
      setResults(data.results);
      setIsOpen(true);
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, selected]);

  function handleSelect(customer: CustomerResult) {
    setSelected(customer);
    setQuery(customer.companyName);
    setIsOpen(false);
    onSelect(customer);
  }

  function handleClear() {
    setSelected(null);
    setQuery("");
    setResults([]);
    onSelect(null);
  }

  async function handleCreate() {
    const companyName = query.trim();
    if (!companyName) return;
    setIsCreating(true);
    setCreateError("");
    try {
      const created = await createCustomerQuick(companyName);
      handleSelect(created);
    } catch {
      setCreateError("고객사 등록에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="relative">
      <input type="hidden" name="customerId" value={selectedId ?? ""} />
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (selected) {
              setSelected(null);
              onSelect(null);
            }
          }}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="고객사명으로 검색 (예: 여주시정신건강복지센터)"
          autoComplete="off"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
        />
        {selected && (
          <button
            type="button"
            onClick={handleClear}
            className="shrink-0 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-100"
          >
            지우기
          </button>
        )}
      </div>

      {selected && (
        <p className="mt-1.5 text-xs text-neutral-500">
          선택됨: {selected.companyName}
          {selected.contactName ? ` · 담당자 ${selected.contactName}` : ""}
          {selected.customerGrade ? ` · ${selected.customerGrade}` : ""}
        </p>
      )}

      {isOpen && query.trim().length > 0 && results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => handleSelect(c)}
                className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-neutral-50"
              >
                <span className="font-medium text-neutral-900">{c.companyName}</span>
                <span className="text-xs text-neutral-500">
                  {c.contactName ?? "담당자 미상"}
                  {c.customerGrade ? ` · ${c.customerGrade}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {isOpen && query.trim().length > 0 && results.length === 0 && !selected && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-neutral-200 bg-white p-3 text-sm shadow-lg">
          <p className="text-neutral-500">검색 결과가 없습니다.</p>
          <button
            type="button"
            onClick={handleCreate}
            disabled={isCreating}
            className="mt-2 w-full rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {isCreating ? "등록 중..." : `"${query.trim()}" 신규 고객사로 등록`}
          </button>
          {createError && <p className="mt-1.5 text-xs text-red-600">{createError}</p>}
        </div>
      )}
    </div>
  );
}
