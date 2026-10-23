/**
 * 팝빌 "거래처목록" 엑셀(.xls)을 세금계산서 거래처 기준정보(tax_invoice_partners)로 가져온다.
 * 사용: npx tsx --env-file=.env.local scripts/import-tax-partners.ts "<파일경로>"
 *
 * - 같은 (사업자등록번호, 종사업장번호)는 한 건으로 합친다 — 파일에는 주담당자/부담당자 행이
 *   따로 있어 이메일만 다르고 나머지는 같다(주담당자 → email, 부담당자 → email2).
 * - 상호 앞의 "[폐업]"은 상호에서 떼고 is_closed로 보관한다.
 * - 다시 실행해도 안전하다(업서트). 화면에서 직접 등록한 거래처(source='manual')는 덮어쓰지 않는다.
 */
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { taxInvoicePartners } from "../src/db/schema";

type Partner = typeof taxInvoicePartners.$inferInsert;

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('파일 경로를 인자로 주세요: import-tax-partners.ts "<파일경로>"');

  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false });
  const headerIdx = rows.findIndex((r) => String(r[1]).trim() === "거래처등록번호");
  if (headerIdx < 0) throw new Error('"거래처등록번호" 헤더 행을 찾지 못했습니다.');

  const map = new Map<string, Partner>();
  for (const r of rows.slice(headerIdx + 1)) {
    const biz = String(r[1]).trim();
    const rawName = String(r[3]).trim();
    if (!biz || !rawName) continue;
    const sub = String(r[2]).trim();
    const closed = /^\[폐업\]/.test(rawName);
    const name = rawName.replace(/^\[폐업\]\s*/, "");
    const email = String(r[13]).trim();
    const role = String(r[15]).trim();
    const key = `${biz}|${sub}`;
    const cur =
      map.get(key) ??
      ({
        businessNumber: biz,
        subNum: sub,
        companyName: name,
        ceoName: String(r[4]).trim() || null,
        address: String(r[5]).trim() || null,
        businessType: String(r[6]).trim() || null,
        businessItem: String(r[7]).trim() || null,
        email: null,
        email2: null,
        isClosed: closed,
        source: "import",
      } satisfies Partner);
    if (email) {
      if (role === "부담당자") cur.email2 = cur.email2 ?? email;
      else cur.email = cur.email ?? email;
    }
    map.set(key, cur);
  }

  const partners = [...map.values()];
  for (const p of partners) {
    await db
      .insert(taxInvoicePartners)
      .values(p)
      .onConflictDoUpdate({
        target: [taxInvoicePartners.businessNumber, taxInvoicePartners.subNum],
        set: {
          companyName: p.companyName,
          ceoName: p.ceoName,
          address: p.address,
          businessType: p.businessType,
          businessItem: p.businessItem,
          email: p.email,
          email2: p.email2,
          isClosed: p.isClosed,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${taxInvoicePartners.source} = 'import'`,
      });
  }
  console.log(`가져옴: ${partners.length}건 (폐업 ${partners.filter((p) => p.isClosed).length}건)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
