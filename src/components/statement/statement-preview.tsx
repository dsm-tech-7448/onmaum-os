import "./statement-preview.css";
import { fmt, num, numberToKorean } from "@/lib/quotes/korean-amount";
import type { StatementDraft } from "@/lib/transaction-statements/types";

export type StatementCompanyInfo = {
  companyName: string;
  ceoName: string;
  businessNumber: string;
  businessType: string;
  businessItem: string;
  address: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  phone: string;
  email: string;
};

function calc(items: StatementDraft["items"]) {
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

function Row({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className="row">
      <span className="k">{k}</span>
      <span className={`v${wide ? " wide" : ""}`}>{v}</span>
    </div>
  );
}

export function StatementPreview({
  draft,
  seal,
  company,
}: {
  draft: StatementDraft;
  seal: string;
  company: StatementCompanyInfo;
}) {
  const { rows, supply, vat, total: itemsTotal } = calc(draft.items);
  const adjustment = num(draft.adjustmentAmount);
  const total = itemsTotal + adjustment;

  return (
    <div className="statement-doc">
      <div className="ci-header">
        <div className="ci-spacer" />
        <div className="ci-title">
          <h1>거 래 명 세 서</h1>
          <p>STATEMENT OF TRANSACTION</p>
          <p className="doc-tag">(공급받는자용)</p>
        </div>
        <div className="doc-no-box">
          <span className="k">거래일자</span>
          <span className="v">{draft.statementDate}</span>
          <span className="k">번호</span>
          <span className="v">{draft.statementNumber}</span>
        </div>
      </div>

      <div className="party-row">
        <div className="stacked-box narrow">
          <div className="vlabel">공급받는자</div>
          <div className="body centered">
            <Row k="등록번호" v={draft.customerBusinessNumber || "-"} />
            <Row k="상호" v={`${draft.customerName || "(고객사 미입력)"} 귀하`} />
            <Row k="담당자" v={draft.customerContactName} />
            <Row k="주소" v={draft.customerAddress} wide />
          </div>
        </div>

        <div className="stacked-box wide">
          <div className="vlabel">공급자</div>
          <div className="body">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="seal-img" src={seal} alt="직인" />
            <Row k="등록번호" v={company.businessNumber} />
            <Row k="상호" v={company.companyName} />
            <Row k="대표" v={company.ceoName} />
            <Row k="사업장주소" v={company.address} wide />
            <Row k="업태" v={company.businessType} />
            <Row k="종목" v={company.businessItem} />
          </div>
        </div>
      </div>

      <div className="amount-banner">
        <div className="lbl">거래금액</div>
        <div className="krw">{numberToKorean(total)} 정</div>
        <div className="num">{fmt(total)}원</div>
      </div>

      <table className="items">
        <colgroup>
          <col style={{ width: 60 }} />
          <col />
          <col style={{ width: 78 }} />
          <col style={{ width: 38 }} />
          <col style={{ width: 54 }} />
          <col style={{ width: 68 }} />
          <col style={{ width: 78 }} />
          <col style={{ width: 66 }} />
          <col style={{ width: 82 }} />
        </colgroup>
        <thead>
          <tr>
            <th>코드</th>
            <th>품명</th>
            <th>규격</th>
            <th>단위</th>
            <th>수량</th>
            <th>단가</th>
            <th>공급가</th>
            <th>세금</th>
            <th>금액</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.uid}>
              <td className="code">{r.code}</td>
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
          {adjustment !== 0 && (
            <tr>
              <td className="code"></td>
              <td className="itemname">{draft.adjustmentLabel || "절삭"}</td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              <td>{fmt(adjustment)}</td>
            </tr>
          )}
          <tr className="total-row">
            <td colSpan={6}>합계</td>
            <td>{fmt(supply)}</td>
            <td>{fmt(vat)}</td>
            <td>{fmt(total)}</td>
          </tr>
        </tbody>
      </table>

      <div className="summary-strip">
        <div className="cell">
          <span className="k">공급가액</span>
          <span className="v">{fmt(supply)}</span>
        </div>
        <div className="cell">
          <span className="k">세액</span>
          <span className="v">{fmt(vat)}</span>
        </div>
        <div className="cell">
          <span className="k">합계금액</span>
          <span className="v">{fmt(total)}</span>
        </div>
        <div className="cell">
          <span className="k">미수금</span>
          <span className="v">{draft.outstandingAmount ? fmt(num(draft.outstandingAmount)) : ""}</span>
        </div>
        <div className="cell">
          <span className="k">인수자</span>
          <span className="v"></span>
        </div>
      </div>

      <div className="account-box">
        <span className="ttl">입금계좌</span>
        <span className="v">
          {company.bankName} {company.accountNumber} (예금주: {company.accountHolder})
        </span>
      </div>

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
