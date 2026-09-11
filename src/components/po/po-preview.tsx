import "./po-preview.css";
import { fmt, num, numberToKorean } from "@/lib/quotes/korean-amount";
import type { PoDraft } from "@/lib/purchase-orders/types";
import type { CompanyFooterInfo } from "@/components/quote/quote-preview";

function calc(items: PoDraft["items"]) {
  let supply = 0;
  let vat = 0;
  const rows = items.map((it) => {
    const qtyNum = num(it.qty);
    const priceNum = num(it.price);
    const amt = qtyNum * priceNum;
    const vatAmt = Math.round(amt * 0.1);
    supply += amt;
    vat += vatAmt;
    return { ...it, qtyNum, priceNum, amt, vatAmt };
  });
  return { rows, supply, vat, total: supply + vat };
}

function Row({
  k,
  v,
  highlight,
  last,
}: {
  k: string;
  v: string;
  highlight?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`row${last ? " last" : ""}${highlight ? " highlight" : ""}`}>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

export function PoPreview({
  draft,
  revision,
  logo,
  company,
}: {
  draft: PoDraft;
  revision: number;
  logo: string;
  company: CompanyFooterInfo;
}) {
  const { rows, supply, vat, total } = calc(draft.items);

  return (
    <div className="po-doc">
      <div className="ci-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src={logo} alt="온마음기프트" />
        <div className="ci-title">
          <h1>발 주 서</h1>
          <p>PURCHASE ORDER</p>
        </div>
        <div style={{ width: 100 }} />
      </div>

      <div className="party-boxes">
        <div className="party-box">
          <div className="hd">공급자</div>
          <div className="body">
            <Row k="발주일자" v={draft.poDate} />
            <Row k="공급자" v={draft.supplierName || "(공급업체 미입력)"} />
            <Row k="전화" v={draft.supplierPhone} />
            <Row k="팩스" v="" />
            <Row k="수신자" v={draft.receiver} />
            <Row k="발송요청일" v={draft.reqDate} highlight />
            <Row k="지불조건" v={draft.payTerm} last />
          </div>
        </div>
        <div className="party-box">
          <div className="hd">공급받는자 (자사)</div>
          <div className="body">
            <Row k="등록번호" v={company.businessNumber} />
            <Row k="상호" v={company.companyName} />
            <Row k="대표" v={company.ceoName} />
            <Row k="업태" v={company.businessType} />
            <Row k="종목" v={company.businessItem} />
            <Row k="주소" v={company.address} />
            <Row k="전화번호" v={company.phone} />
            <Row k="팩스" v={company.fax ?? ""} last />
          </div>
        </div>
      </div>

      <div className="amount-banner">
        <div className="lbl">발주금액</div>
        <div className="krw">{numberToKorean(total)} 정</div>
        <div className="num">{fmt(total)}원</div>
      </div>

      <table className="items">
        <colgroup>
          <col />
          <col style={{ width: 78 }} />
          <col style={{ width: 38 }} />
          <col style={{ width: 54 }} />
          <col style={{ width: 68 }} />
          <col style={{ width: 86 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 88 }} />
        </colgroup>
        <thead>
          <tr>
            <th>품목명</th>
            <th>규격</th>
            <th>단위</th>
            <th>수량</th>
            <th>단가</th>
            <th>공급가</th>
            <th>세금</th>
            <th>합계</th>
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
              <td>{r.amt ? fmt(r.amt + r.vatAmt) : "-"}</td>
            </tr>
          ))}
          <tr className="total-row">
            <td colSpan={5}>총계</td>
            <td>{fmt(supply)}</td>
            <td>{fmt(vat)}</td>
            <td>{fmt(total)}</td>
          </tr>
        </tbody>
      </table>

      <div className="note-box numbered-notes">
        <p>
          <span className="num">1. 인쇄 :</span> {draft.printNote}
        </p>
        <p>
          <span className="num">2. 배송</span>
        </p>
        <p className="sub">- 주소 : {draft.shipAddr}</p>
        <p className="sub">- 수령자 : {draft.shipReceiver}</p>
        <p>
          <span className="num">3. 특기사항</span>
        </p>
        <div className="note-body">{draft.note}</div>
        <p>
          <span className="num">4. 요청사항</span>
        </p>
        <div className="note-body">{draft.requestNote}</div>
      </div>

      {/* 발주서는 직인을 찍지 않는다(견적서/거래명세서와 다름) */}
      <div className="doc-footer">
        <table>
          <tbody>
            <tr>
              <td className="k">발신처</td>
              <td>
                온마음기프트 / {company.companyName}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="po-no">
          {draft.poNumber} (Rev.{String(revision).padStart(2, "0")})
        </p>
      </div>
    </div>
  );
}
