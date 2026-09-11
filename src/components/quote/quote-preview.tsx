import "./quote-preview.css";
import { fmt, num, numberToKorean } from "@/lib/quotes/korean-amount";
import type { QuoteDraft, QuoteItemDraft } from "@/lib/quotes/types";

type CalcRow = QuoteItemDraft & { qtyNum: number; priceNum: number; amt: number; vatAmt: number };

function calc(items: QuoteItemDraft[]) {
  let supply = 0;
  let vat = 0;
  const rows: CalcRow[] = items.map((it) => {
    const qtyNum = num(it.qty);
    const priceNum = num(it.price);
    // 단가로 나누어떨어지지 않는 공급가는 수기 입력된 값(supplyOverride)을 그대로 쓴다.
    const amt = it.supplyOverride ? num(it.supplyOverride) : qtyNum * priceNum;
    const vatAmt = Math.round(amt * 0.1);
    supply += amt;
    vat += vatAmt;
    return { ...it, qtyNum, priceNum, amt, vatAmt };
  });
  return { rows, supply, vat, total: supply + vat };
}

export type CompanyFooterInfo = {
  companyName: string;
  ceoName: string;
  businessNumber: string;
  businessType: string;
  businessItem: string;
  address: string;
  phone: string;
  email: string;
  fax?: string; // 발주서의 공급받는자(자사) 팩스 칸에만 쓴다
};

function DocHeader({ logo, title, sub }: { logo: string; title: string; sub: string }) {
  return (
    <div className="ci-header">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo" src={logo} alt="온마음기프트" />
      <div className="ci-title">
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      <div style={{ width: 100 }} />
    </div>
  );
}

function DocFooter({ seal, company }: { seal: string; company: CompanyFooterInfo }) {
  return (
    <div className="doc-footer">
      <table>
        <tbody>
          <tr>
            <td className="k">상호</td>
            <td>{company.companyName}</td>
            <td className="k">대표</td>
            <td>
              <span style={{ display: "inline-flex", alignItems: "center" }}>
                {company.ceoName}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={seal} alt="직인" style={{ width: 60, marginLeft: -14, marginTop: 5 }} />
              </span>
            </td>
          </tr>
          <tr>
            <td className="k">사업자등록번호</td>
            <td>{company.businessNumber}</td>
            <td className="k">업태/종목</td>
            <td>
              {company.businessType} / {company.businessItem}
            </td>
          </tr>
          <tr>
            <td className="k">주소</td>
            <td colSpan={3}>{company.address}</td>
          </tr>
          <tr>
            <td className="k">전화</td>
            <td>{company.phone}</td>
            <td className="k">이메일</td>
            <td>{company.email}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function QuotePreview({
  draft,
  revision,
  logo,
  seal,
  company,
}: {
  draft: QuoteDraft;
  revision: number;
  logo: string;
  seal: string;
  company: CompanyFooterInfo;
}) {
  if (draft.mode === "compare") {
    return <QuoteComparePreview draft={draft} revision={revision} logo={logo} seal={seal} company={company} />;
  }

  const { rows, supply, vat, total: itemsTotal } = calc(draft.items);
  const adjustment = num(draft.adjustmentAmount);
  const total = itemsTotal + adjustment;
  const firstImageLabel = rows[0]?.name ?? "";
  // 품목(product) 줄마다 이미지를 따로 넣을 수 있다 — 복수 품목 견적서에서 상품이 여러 개일 때
  // 각각 사진을 붙이기 위함. 기존 견적서 공용 이미지(mainImageDataUrl)도 그대로 지원(하위호환).
  const productImages = [
    ...(draft.mainImageDataUrl ? [{ url: draft.mainImageDataUrl, label: firstImageLabel }] : []),
    ...rows.filter((r) => r.imageDataUrl).map((r) => ({ url: r.imageDataUrl as string, label: r.name })),
  ];

  return (
    <div className="quote-doc">
      <DocHeader logo={logo} title="견 적 서" sub="QUOTATION" />
      <div className="top-info">
        <div className="customer-block">
          <p className="to">{draft.customerName || "(고객사 미입력)"} 귀하</p>
          <p className="desc">아래와 같이 견적합니다.</p>
        </div>
        <table className="meta-table" style={{ width: "auto" }}>
          <tbody>
            <tr>
              <td className="k">견적번호</td>
              <td>
                {draft.quoteNumber}{" "}
                <span style={{ color: "#8E1F3B", fontWeight: "bold" }}>
                  (Rev.{String(revision).padStart(2, "0")})
                </span>
              </td>
            </tr>
            <tr>
              <td className="k">견적일자</td>
              <td>{draft.quoteDate}</td>
            </tr>
            <tr>
              <td className="k">유효기간</td>
              <td>{draft.validity}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="amount-banner">
        <div className="lbl">견적금액</div>
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
          <col style={{ width: 86 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 88 }} />
        </colgroup>
        <thead>
          <tr>
            <th>코드</th>
            <th>품목</th>
            <th>규격</th>
            <th>단위</th>
            <th>수량</th>
            <th>단가</th>
            <th>공급가</th>
            <th>부가세</th>
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
        </tbody>
      </table>

      {productImages.length > 0 && (
        <div className="imgsec">
          <div className="ttl">상품 이미지</div>
          <div className="grid">
            {productImages.map((img, idx) => (
              <div className="item" key={idx}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.label} />
                <div className="cap">{img.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bottom">
        <div className="confirm-box">
          <div className="ttl">확인사항</div>
          <div>{draft.confirmText}</div>
        </div>
        <table className="summary-table">
          <tbody>
            <tr>
              <td className="k">공급가액</td>
              <td style={{ textAlign: "right" }}>{fmt(supply)} 원</td>
            </tr>
            <tr>
              <td className="k">부가세(10%)</td>
              <td style={{ textAlign: "right" }}>{fmt(vat)} 원</td>
            </tr>
            {adjustment !== 0 && (
              <tr>
                <td className="k">{draft.adjustmentLabel || "절삭"}</td>
                <td style={{ textAlign: "right" }}>{fmt(adjustment)} 원</td>
              </tr>
            )}
            <tr className="total">
              <td className="k" style={{ background: "#8E1F3B" }}>
                합계금액
              </td>
              <td style={{ textAlign: "right" }}>{fmt(total)} 원</td>
            </tr>
          </tbody>
        </table>
      </div>

      <DocFooter seal={seal} company={company} />
    </div>
  );
}

function QuoteComparePreview({
  draft,
  revision,
  logo,
  seal,
  company,
}: {
  draft: QuoteDraft;
  revision: number;
  logo: string;
  seal: string;
  company: CompanyFooterInfo;
}) {
  // 단일 상품 표와 같은 한 장의 표에 구간마다의 수량/단가 행을 모두 나열한다 — 카드 나열보다
  // 행 단위로 나란히 비교하는 편이 실제 견적서(레거시 PDF)와 같고 한눈에 비교하기 쉽다.
  // 구간들은 "둘 다 주문"이 아니라 "수량별 대안 비교"라서 전체 합계는 의미가 없다 — 행별
  // 금액(구간 합계)까지만 보여주고, 견적금액 배너·공급가액/부가세/합계 표는 만들지 않는다.
  const allItems = draft.tiers.flatMap((tier) => tier.items);
  const { rows } = calc(allItems);
  const productName = draft.compareProductName || "(품목명 미입력)";
  // 구간 공통 이미지(mainImageDataUrl) + 필요하면 품목 줄마다 따로 넣은 이미지도 함께 보여준다.
  const productImages = [
    ...(draft.mainImageDataUrl ? [{ url: draft.mainImageDataUrl, label: productName }] : []),
    ...rows
      .filter((r) => r.imageDataUrl)
      .map((r) => ({ url: r.imageDataUrl as string, label: r.name || productName })),
  ];

  return (
    <div className="quote-doc">
      <DocHeader logo={logo} title="견 적 서" sub="QUOTATION" />
      <div className="top-info">
        <div className="customer-block">
          <p className="to">{draft.customerName || "(고객사 미입력)"} 귀하</p>
          <p className="desc">아래와 같이 수량 구간별로 견적합니다.</p>
        </div>
        <table className="meta-table" style={{ width: "auto" }}>
          <tbody>
            <tr>
              <td className="k">견적번호</td>
              <td>
                {draft.quoteNumber}{" "}
                <span style={{ color: "#8E1F3B", fontWeight: "bold" }}>
                  (Rev.{String(revision).padStart(2, "0")})
                </span>
              </td>
            </tr>
            <tr>
              <td className="k">견적일자</td>
              <td>{draft.quoteDate}</td>
            </tr>
            <tr>
              <td className="k">유효기간</td>
              <td>{draft.validity}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <table className="items">
        <colgroup>
          <col style={{ width: 60 }} />
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
            <th>코드</th>
            <th>품목</th>
            <th>규격</th>
            <th>단위</th>
            <th>수량</th>
            <th>단가</th>
            <th>공급가</th>
            <th>부가세</th>
            <th>금액</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.uid}>
              <td className="code">{r.code || (idx === 0 ? draft.compareProductCode : "")}</td>
              <td className="itemname">{r.name || (idx === 0 ? productName : "")}</td>
              <td>{r.spec || (idx === 0 ? draft.compareProductSpec : "")}</td>
              <td>{r.unit || "개"}</td>
              <td>{r.qtyNum ? r.qtyNum.toLocaleString() : "-"}</td>
              <td>{r.priceNum ? fmt(r.priceNum) : "-"}</td>
              <td>{r.amt ? fmt(r.amt) : "-"}</td>
              <td>{r.vatAmt ? fmt(r.vatAmt) : "-"}</td>
              <td>{r.amt ? fmt(r.amt + r.vatAmt) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {productImages.length > 0 && (
        <div className="imgsec">
          <div className="ttl">상품 이미지</div>
          <div className="grid">
            {productImages.map((img, idx) => (
              <div className="item" key={idx}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.label} />
                <div className="cap">{img.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bottom">
        <div className="confirm-box">
          <div className="ttl">확인사항</div>
          <div>{draft.confirmText}</div>
        </div>
      </div>

      <DocFooter seal={seal} company={company} />
    </div>
  );
}
