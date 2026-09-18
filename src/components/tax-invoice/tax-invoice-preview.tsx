import "./tax-invoice-preview.css";
import { fmt, num } from "@/lib/quotes/korean-amount";
import type { TaxInvoiceDraft, TaxInvoiceStatus } from "@/lib/tax-invoices/types";

export type TaxInvoiceCompanyInfo = {
  companyName: string;
  ceoName: string;
  businessNumber: string;
  address: string;
  phone: string;
  email: string;
};

const STATUS_LABEL: Record<TaxInvoiceStatus, string> = {
  requested: "발행 요청됨",
  confirmed: "확인됨 (발행 대기)",
  issued: "발행 완료",
};
const STATUS_COLOR: Record<TaxInvoiceStatus, { bg: string; fg: string }> = {
  requested: { bg: "#fef3c7", fg: "#92400e" },
  confirmed: { bg: "#dbeafe", fg: "#1e40af" },
  issued: { bg: "#dcfce7", fg: "#166534" },
};

function calc(items: TaxInvoiceDraft["items"]) {
  let supply = 0;
  let vat = 0;
  const rows = items.map((it) => {
    const qtyNum = num(it.qty);
    const priceNum = num(it.price);
    // 견적서에서 단가 없이 공급가를 직접 입력한 품목은 그 값을 그대로 이어받는다.
    const amt = it.supplyOverride ? num(it.supplyOverride) : qtyNum * priceNum;
    const vatAmt = Math.round(amt * 0.1);
    supply += amt;
    vat += vatAmt;
    return { ...it, qtyNum, priceNum, amt, vatAmt };
  });
  return { rows, supply, vat, total: supply + vat };
}

export function TaxInvoicePreview({
  draft,
  status,
  logo,
  seal,
  company,
}: {
  draft: TaxInvoiceDraft;
  status: TaxInvoiceStatus;
  logo: string;
  seal: string;
  company: TaxInvoiceCompanyInfo;
}) {
  const { rows, supply, vat, total } = calc(draft.items);
  const statusColor = STATUS_COLOR[status];

  return (
    <div className="tax-invoice-doc">
      <div className="ci-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src={logo} alt="온마음기프트" />
        <div className="ci-title">
          <h1>세 금 계 산 서</h1>
          <p>TAX INVOICE</p>
          <span
            className="status-badge"
            style={{ background: statusColor.bg, color: statusColor.fg }}
          >
            {STATUS_LABEL[status]}
          </span>
        </div>
        <div style={{ width: 100 }} />
      </div>

      <table className="info-table">
        <tbody>
          <tr>
            <td className="k" style={{ width: 130 }}>
              세금계산서번호
            </td>
            <td>{draft.invoiceNumber}</td>
            <td className="k">발행예정일</td>
            <td>{draft.scheduledDate}</td>
          </tr>
          <tr>
            <td className="k" rowSpan={4}>
              공급자
            </td>
            <td>등록번호</td>
            <td colSpan={2}>{company.businessNumber}</td>
          </tr>
          <tr>
            <td>상호</td>
            <td className="sealcell" colSpan={2}>
              <span>{company.companyName}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="seal-img" src={seal} alt="직인" />
            </td>
          </tr>
          <tr>
            <td>대표</td>
            <td colSpan={2}>{company.ceoName}</td>
          </tr>
          <tr>
            <td>주소</td>
            <td colSpan={2}>{company.address}</td>
          </tr>
          <tr>
            <td className="k" rowSpan={5}>
              공급받는자
            </td>
            <td>등록번호</td>
            <td colSpan={2}>{draft.customerBusinessNumber || "-"}</td>
          </tr>
          <tr>
            <td>상호</td>
            <td colSpan={2}>{draft.customerName || "(고객사 미입력)"} 귀하</td>
          </tr>
          <tr>
            <td>대표</td>
            <td colSpan={2}>{draft.customerCeoName}</td>
          </tr>
          <tr>
            <td>주소</td>
            <td colSpan={2}>{draft.customerAddress}</td>
          </tr>
          <tr>
            <td>업태/종목</td>
            <td colSpan={2}>
              {draft.customerBusinessType}
              {draft.customerBusinessType && draft.customerBusinessItem ? " / " : ""}
              {draft.customerBusinessItem}
            </td>
          </tr>
        </tbody>
      </table>

      <table className="items">
        <colgroup>
          <col />
          <col style={{ width: 105 }} />
          <col style={{ width: 40 }} />
          <col style={{ width: 58 }} />
          <col style={{ width: 74 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 90 }} />
        </colgroup>
        <thead>
          <tr>
            <th>품목명</th>
            <th>규격</th>
            <th>단위</th>
            <th>수량</th>
            <th>단가</th>
            <th>공급가액</th>
            <th>세액</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.uid}>
              <td className="itemname">{r.name}</td>
              <td>{r.spec}</td>
              <td>{r.unit || "개"}</td>
              <td>{r.qtyNum ? r.qtyNum.toLocaleString() : "-"}</td>
              <td>{r.priceNum ? fmt(r.priceNum) : "-"}</td>
              <td>{r.amt ? fmt(r.amt) : "-"}</td>
              <td>{r.vatAmt ? fmt(r.vatAmt) : "-"}</td>
            </tr>
          ))}
          <tr className="total-row">
            <td colSpan={5}>합계 (공급가액 {fmt(supply)} + 세액 {fmt(vat)})</td>
            <td colSpan={2}>{fmt(total)}</td>
          </tr>
        </tbody>
      </table>

      <div className="note-box">
        <div className="ttl">비고</div>
        <div>{draft.note}</div>
      </div>

      <div className="doc-footer">
        <table>
          <tbody>
            <tr>
              <td className="k">문의전화</td>
              <td>{company.phone}</td>
              <td className="k">이메일</td>
              <td>{company.email}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
