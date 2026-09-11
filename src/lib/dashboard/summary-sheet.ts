import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  quotes,
  quoteItems,
  purchaseOrders,
  poItems,
  statementItems,
  transactionStatements,
  taxInvoices,
  production,
  projects,
  customers,
  projectRequests,
  summaryOverrides,
  historicalOrders,
} from "@/db/schema";

// Summary 장표 — 견적 품목(quote_item) 하나가 한 행이다("발주서 anchor" 방식이던 예전
// ledger.ts와 다른 점). 발주/거래명세서가 아직 없어도 견적만으로 행이 생긴다 — 견적으로
// 끝난 건도 기록에 남아야 한다는 요건 때문(2026-09-03). 발주/거래명세서는 quote_item_id로
// LEFT JOIN해서 있으면 채우고 없으면 빈칸으로 둔다.
export type SummaryRow = {
  rowKey: string; // React key — quoteItemId가 없는 orphan 발주서 행도 있어 별도로 둔다.
  quoteId: string | null; // 견적 헤더(날짜/담당자/기관명/연락처) 수정용 — orphan 행은 null.
  quoteItemId: string | null; // orphan 발주서 행(견적 품목 매칭 안 됨)은 null.
  projectId: string;
  projectNumber: string;
  orderDate: string; // 날짜 (견적일자)
  contactName: string; // 담당자
  customerName: string; // 기관명
  contactPhone: string; // 연락처
  productCode: string;
  productName: string;
  qty: string;
  poId: string | null;
  reqDate: string; // 납기 (발주서 발송요청일)
  customerRequests: string; // 고객 요청사항 — project_requests(source=customer, 미해결) 합친 텍스트
  statementId: string | null;
  paidCash: string; // 고객 입금 - 현금
  paidCard: string; // 고객 입금 - 카드
  taxInvoiceIssuedAt: string; // 영수증 - 세금계산서 (읽기 전용)
  cashReceiptIssuedAt: string; // 영수증 - 현금영수증
  cardReceiptIssuedAt: string; // 영수증 - 카드영수증 (paidCard가 있을 때의 paidDate, 읽기 전용)
  supplierName: string;
  supplierPhone: string; // 공급업체 연락처
  shipDate: string; // 출고날짜(발송일) (production.actualShipDate)
  outAmount: string; // 출금 (공급업체에 입금)
  revenue: number | null; // 매출 (매칭된 statement_items 공급가 합)
  cost: number | null; // 매입 (매칭된 po_items 합) — 발주 없으면 null(0 아님, "모른다"는 뜻)
  profit: number | null; // 매출이익금
  marginRate: number | null; // 매출이익률
  overriddenFields: string[]; // summary_overrides로 원본 값을 덮어쓴 필드 이름들 (UI 표시용)
  isHistorical: boolean; // historical_orders(과거 Daily Summary 엑셀 이관) 출처 행 — 연결된 프로젝트/문서가 없어 읽기 전용.
};

// includeHistorical: historical_orders(과거 Daily Summary 엑셀 이관, 3천여 건)를 포함할지 —
// 대시보드 요약/주간·월간 실적(getDashboardSummary)은 매 페이지 로드마다 호출되고, 과거
// 이력을 매번 다 훑으면 느려질 뿐 아니라 "이번 주/이번 달"에 섞일 일도 없어 기본은 제외.
// Summary 화면 자체에서만 명시적으로 true로 요청한다(2026-09-03).
export async function getSummaryRows(options?: { includeHistorical?: boolean }): Promise<SummaryRow[]> {
  // 1. 프로젝트당 견적번호별 최신 리비전만.
  const quoteRows = await db
    .select({
      id: quotes.id,
      projectId: quotes.projectId,
      quoteNumber: quotes.quoteNumber,
      revision: quotes.revision,
      quoteDate: quotes.quoteDate,
      customerName: quotes.customerName,
      contactName: quotes.contactName,
      contactPhone: quotes.contactPhone,
    })
    .from(quotes);

  const latestQuoteByKey = new Map<string, (typeof quoteRows)[number]>();
  for (const q of quoteRows) {
    const key = `${q.projectId}:${q.quoteNumber}`;
    const existing = latestQuoteByKey.get(key);
    if (!existing || q.revision > existing.revision) latestQuoteByKey.set(key, q);
  }
  const latestQuotes = Array.from(latestQuoteByKey.values());
  if (latestQuotes.length === 0) return [];

  const quoteIds = latestQuotes.map((q) => q.id);
  const quoteById = new Map(latestQuotes.map((q) => [q.id, q]));

  // 2. 견적 품목 (product 줄만 — 옵션 줄은 발주/명세서 매칭 대상이 아니다).
  const itemRows = await db
    .select({
      id: quoteItems.id,
      quoteId: quoteItems.quoteId,
      code: quoteItems.code,
      name: quoteItems.name,
      qty: quoteItems.qty,
      lineType: quoteItems.lineType,
    })
    .from(quoteItems)
    .where(inArray(quoteItems.quoteId, quoteIds));
  const items = itemRows.filter((it) => it.lineType === "product" && quoteById.has(it.quoteId));
  if (items.length === 0) return [];

  const quoteItemIds = items.map((it) => it.id);

  // 3. 발주서 — quote_item_id로 매칭, 같은 발주번호는 최신 리비전만. 실데이터에는
  // quote_item_id가 비어있는 발주서도 있다(견적 품목 선택 없이 저장된 과거 건) — 이런
  // 건도 매입액이 사라지면 안 되므로 전체 발주서를 우선 다 가져온 다음, 매칭되는 것과
  // 안 되는 것(orphan)을 나눈다.
  const allPoRows = await db
    .select({
      id: purchaseOrders.id,
      projectId: purchaseOrders.projectId,
      poNumber: purchaseOrders.poNumber,
      revision: purchaseOrders.revision,
      quoteItemId: purchaseOrders.quoteItemId,
      supplierName: purchaseOrders.supplierName,
      supplierPhone: purchaseOrders.supplierPhone,
      reqDate: purchaseOrders.reqDate,
      note: purchaseOrders.note,
      paidAmount: purchaseOrders.paidAmount,
    })
    .from(purchaseOrders);

  const latestPoByKey = new Map<string, (typeof allPoRows)[number]>();
  for (const po of allPoRows) {
    const key = `${po.projectId}:${po.poNumber}`;
    const existing = latestPoByKey.get(key);
    if (!existing || po.revision > existing.revision) latestPoByKey.set(key, po);
  }
  const quoteItemIdSet = new Set(quoteItemIds);
  const poByQuoteItemId = new Map<string, (typeof allPoRows)[number]>();
  const orphanPos: (typeof allPoRows)[number][] = [];
  for (const po of latestPoByKey.values()) {
    if (po.quoteItemId && quoteItemIdSet.has(po.quoteItemId)) {
      poByQuoteItemId.set(po.quoteItemId, po);
    } else {
      orphanPos.push(po);
    }
  }
  const poIds = [...Array.from(poByQuoteItemId.values()).map((po) => po.id), ...orphanPos.map((po) => po.id)];

  // 프로젝트+고객사 — 견적이 있는 프로젝트와 orphan 발주서가 속한 프로젝트를 합쳐서 한 번에.
  const allProjectIds = [...new Set([...latestQuotes.map((q) => q.projectId), ...orphanPos.map((po) => po.projectId)])];
  const projectRows = await db
    .select({ id: projects.id, projectNumber: projects.projectNumber, customerName: customers.companyName })
    .from(projects)
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .where(inArray(projects.id, allProjectIds));
  const projectById = new Map(projectRows.map((p) => [p.id, p]));

  // 4. 발주 품목(매입 계산용, orphan 행의 품목명 소스) + 배송 정보.
  const poItemRows = poIds.length
    ? await db
        .select({ poId: poItems.poId, name: poItems.name, qty: poItems.qty, price: poItems.price })
        .from(poItems)
        .where(inArray(poItems.poId, poIds))
    : [];
  const costByPoId = new Map<string, number>();
  const namesByPoId = new Map<string, string[]>();
  for (const it of poItemRows) {
    costByPoId.set(it.poId, (costByPoId.get(it.poId) ?? 0) + Number(it.qty ?? 0) * Number(it.price ?? 0));
    const names = namesByPoId.get(it.poId) ?? [];
    names.push(it.name);
    namesByPoId.set(it.poId, names);
  }

  const productionRows = poIds.length
    ? await db
        .select({ poId: production.poId, actualShipDate: production.actualShipDate })
        .from(production)
        .where(inArray(production.poId, poIds))
    : [];
  const shipDateByPoId = new Map<string, string>();
  for (const r of productionRows) {
    if (r.poId && r.actualShipDate) shipDateByPoId.set(r.poId, r.actualShipDate);
  }

  // 5. 거래명세서 품목 — quote_item_id로 매칭. 실데이터는 statement_items.quote_item_id도
  // 전부 비어있다(발주서와 같은 이유 — 이 필드가 이번 세션에 나중에 추가됨). 매출이 조용히
  // 사라지지 않도록 전체를 가져와서 매칭/orphan으로 나눈다(발주서와 같은 패턴).
  const allStmtItemRows = await db
    .select({
      id: statementItems.id,
      quoteItemId: statementItems.quoteItemId,
      lineType: statementItems.lineType,
      name: statementItems.name,
      qty: statementItems.qty,
      price: statementItems.price,
      supplyOverride: statementItems.supplyOverride,
      statementId: statementItems.statementId,
    })
    .from(statementItems);

  function stmtLineAmount(r: { supplyOverride: string | null; qty: string | null; price: string | null }): number {
    return r.supplyOverride != null ? Number(r.supplyOverride) : Number(r.qty ?? 0) * Number(r.price ?? 0);
  }

  // 견적 총액 계산(buildQuoteReference)과 같은 원칙(2026-09-10 피드백: "summary에 저장될
  // 때는 견적서 전체 금액이 적용되어야 해, 옵션은 표현하지 말아줘") — 명세서 하나의 총액
  // (품목+옵션 전부 합)을, 그 안의 품목(product) 줄들에 각자 금액 비중대로 나눠서 매출로
  // 배정한다. 배송비·포장비 같은 옵션 줄은 그 자체로 Summary 행이 되지 않고 합계에만
  // 녹아 들어간다 — 품목이 1개뿐인 명세서(실제로 거의 전부)는 결국 전체 금액이 그대로
  // 그 품목의 매출이 된다. 품목이 여러 개면 각 품목 줄 금액 비중대로 옵션을 나눠 갖는다.
  const itemsByStatementId = new Map<string, (typeof allStmtItemRows)[number][]>();
  for (const r of allStmtItemRows) {
    const arr = itemsByStatementId.get(r.statementId) ?? [];
    arr.push(r);
    itemsByStatementId.set(r.statementId, arr);
  }

  type AllocatedStmtLine = {
    id: string;
    statementId: string;
    quoteItemId: string | null;
    name: string;
    qty: string | null;
    revenue: number; // 명세서 전체 금액 중 이 품목 줄에 배분된 몫
  };
  const allocatedProductLines: AllocatedStmtLine[] = [];
  for (const [statementId, lines] of itemsByStatementId) {
    const fullTotal = lines.reduce((sum, l) => sum + stmtLineAmount(l), 0);
    const productLines = lines.filter((l) => l.lineType === "product");
    const productLinesTotal = productLines.reduce((sum, l) => sum + stmtLineAmount(l), 0);
    for (const line of productLines) {
      const amt = stmtLineAmount(line);
      // 품목 합계가 0이면(수기 입력 누락 등) 배분 비율을 못 구하니 안전하게 줄 자체
      // 금액만 쓴다.
      const revenue = productLinesTotal > 0 ? (amt / productLinesTotal) * fullTotal : amt;
      allocatedProductLines.push({ id: line.id, statementId, quoteItemId: line.quoteItemId, name: line.name, qty: line.qty, revenue });
    }
  }

  const matchedStmtItems = allocatedProductLines.filter((r) => r.quoteItemId && quoteItemIdSet.has(r.quoteItemId));
  const orphanStmtItems = allocatedProductLines.filter((r) => !r.quoteItemId || !quoteItemIdSet.has(r.quoteItemId));

  const allStatementIds = [...new Set(allStmtItemRows.map((r) => r.statementId))];
  const statementRows = allStatementIds.length
    ? await db
        .select({
          id: transactionStatements.id,
          projectId: transactionStatements.projectId,
          customerName: transactionStatements.customerName,
          paidCash: transactionStatements.paidCash,
          paidCard: transactionStatements.paidCard,
          paidDate: transactionStatements.paidDate,
          cashReceiptIssuedAt: transactionStatements.cashReceiptIssuedAt,
        })
        .from(transactionStatements)
        .where(inArray(transactionStatements.id, allStatementIds))
    : [];
  const statementById = new Map(statementRows.map((s) => [s.id, s]));

  const taxInvoiceRows = allStatementIds.length
    ? await db
        .select({ statementId: taxInvoices.statementId, issuedAt: taxInvoices.issuedAt })
        .from(taxInvoices)
        .where(inArray(taxInvoices.statementId, allStatementIds))
    : [];
  const taxInvoiceByStatementId = new Map(taxInvoiceRows.map((r) => [r.statementId, r.issuedAt]));

  const matchByQuoteItemId = new Map<string, { statementId: string; revenue: number }>();
  for (const r of matchedStmtItems) {
    if (!r.quoteItemId) continue;
    const existing = matchByQuoteItemId.get(r.quoteItemId);
    matchByQuoteItemId.set(r.quoteItemId, {
      statementId: r.statementId,
      revenue: (existing?.revenue ?? 0) + r.revenue,
    });
  }

  // orphan 거래명세서 품목이 속한 프로젝트가 아직 projectById에 없으면 보충해서 채운다.
  const missingProjectIds = [...new Set(orphanStmtItems.map((r) => statementById.get(r.statementId)?.projectId))]
    .filter((id): id is string => !!id && !projectById.has(id));
  if (missingProjectIds.length) {
    const extraProjectRows = await db
      .select({ id: projects.id, projectNumber: projects.projectNumber, customerName: customers.companyName })
      .from(projects)
      .innerJoin(customers, eq(projects.customerId, customers.id))
      .where(inArray(projects.id, missingProjectIds));
    for (const p of extraProjectRows) projectById.set(p.id, p);
  }

  // 고객 요청사항 — 프로젝트 단위 기록(project_requests, 체크리스트 대시보드용으로 이미
  // 만들어둔 테이블)을 그대로 재사용한다. 미해결(resolvedAt IS NULL) + source=customer만
  // 모아서 프로젝트당 한 줄로 합친다 — 이 표는 품목 단위 행이라 같은 프로젝트의 여러
  // 품목 행에 똑같이 반복해서 보여준다.
  const allKnownProjectIds = [...projectById.keys()];
  const requestRows = allKnownProjectIds.length
    ? await db
        .select({ projectId: projectRequests.projectId, content: projectRequests.content })
        .from(projectRequests)
        .where(
          and(
            eq(projectRequests.source, "customer"),
            isNull(projectRequests.resolvedAt),
            inArray(projectRequests.projectId, allKnownProjectIds)
          )
        )
    : [];
  const requestsByProject = new Map<string, string[]>();
  for (const r of requestRows) {
    const arr = requestsByProject.get(r.projectId) ?? [];
    arr.push(r.content);
    requestsByProject.set(r.projectId, arr);
  }

  // 6. 조립 — 견적 품목 기준 행.
  const quoteItemRows: SummaryRow[] = items
    .map((it): SummaryRow | null => {
      const quote = quoteById.get(it.quoteId);
      if (!quote) return null;
      const project = projectById.get(quote.projectId);
      const po = poByQuoteItemId.get(it.id);
      const match = matchByQuoteItemId.get(it.id);
      const statement = match ? statementById.get(match.statementId) : undefined;

      const cost = po ? (costByPoId.get(po.id) ?? 0) : null;
      const revenue = match ? match.revenue : null;
      const profit = revenue != null && cost != null ? revenue - cost : null;
      const marginRate = revenue ? (profit as number) / revenue : null;

      return {
        rowKey: it.id,
        quoteId: quote.id,
        quoteItemId: it.id,
        projectId: quote.projectId,
        projectNumber: project?.projectNumber ?? "-",
        orderDate: quote.quoteDate ?? "",
        contactName: quote.contactName ?? "",
        customerName: quote.customerName,
        contactPhone: quote.contactPhone ?? "",
        productCode: it.code ?? "",
        productName: it.name,
        qty: it.qty ?? "",
        poId: po?.id ?? null,
        reqDate: po?.reqDate ?? "",
        customerRequests: requestsByProject.get(quote.projectId)?.join("; ") ?? "",
        statementId: match?.statementId ?? null,
        paidCash: statement?.paidCash ?? "",
        paidCard: statement?.paidCard ?? "",
        taxInvoiceIssuedAt: match?.statementId
          ? (taxInvoiceByStatementId.get(match.statementId)?.toISOString().slice(0, 10) ?? "")
          : "",
        cashReceiptIssuedAt: statement?.cashReceiptIssuedAt ?? "",
        cardReceiptIssuedAt: statement?.paidCard ? (statement.paidDate ?? "") : "",
        supplierName: po?.supplierName ?? "",
        supplierPhone: po?.supplierPhone ?? "",
        shipDate: po ? (shipDateByPoId.get(po.id) ?? "") : "",
        outAmount: po?.paidAmount ?? "",
        revenue,
        cost,
        profit,
        marginRate,
        overriddenFields: [],
        isHistorical: false,
      };
    })
    .filter((r): r is SummaryRow => r !== null);

  // 7. orphan 발주서 행 — 견적 품목과 매칭이 안 된 발주서(quote_item_id 비어있거나 잘못됨).
  // 매입액이 조용히 사라지지 않도록 별도 행으로 넣는다. 매출/영수증은 매칭할 견적 품목이
  // 없어 항상 빈칸("이 발주서가 어느 매출과 짝인지 모른다"는 뜻).
  const orphanRows: SummaryRow[] = orphanPos.map((po) => {
    const project = projectById.get(po.projectId);
    const cost = costByPoId.get(po.id) ?? 0;
    return {
      rowKey: `po-${po.id}`,
      quoteId: null,
      quoteItemId: null,
      projectId: po.projectId,
      projectNumber: project?.projectNumber ?? "-",
      orderDate: "",
      contactName: "",
      customerName: project?.customerName ?? "-",
      contactPhone: "",
      productCode: "",
      productName: namesByPoId.get(po.id)?.join(", ") || "-",
      qty: "",
      poId: po.id,
      reqDate: po.reqDate ?? "",
      customerRequests: requestsByProject.get(po.projectId)?.join("; ") ?? "",
      statementId: null,
      paidCash: "",
      paidCard: "",
      taxInvoiceIssuedAt: "",
      cashReceiptIssuedAt: "",
      cardReceiptIssuedAt: "",
      supplierName: po.supplierName,
      supplierPhone: po.supplierPhone ?? "",
      shipDate: shipDateByPoId.get(po.id) ?? "",
      outAmount: po.paidAmount ?? "",
      revenue: null,
      cost,
      profit: null,
      marginRate: null,
      overriddenFields: [],
      isHistorical: false,
    };
  });

  // 8. orphan 거래명세서 품목 행 — 견적 품목과 매칭이 안 된 거래명세서 품목(quote_item_id
  // 비어있거나 잘못됨). 매출이 조용히 사라지지 않도록 별도 행으로 넣는다. statementId는
  // 알고 있으니 결제/현금영수증 인라인 입력은 그대로 가능하다 — 매입/매출이익만 모른다
  // (어느 발주서와 짝인지 알 방법이 없어서).
  const orphanStatementRows: SummaryRow[] = orphanStmtItems.map((r) => {
    const statement = statementById.get(r.statementId);
    const project = statement ? projectById.get(statement.projectId) : undefined;
    const revenue = r.revenue;
    return {
      rowKey: `stmt-${r.id}`,
      quoteId: null,
      quoteItemId: null,
      projectId: statement?.projectId ?? "",
      projectNumber: project?.projectNumber ?? "-",
      orderDate: "",
      contactName: "",
      customerName: statement?.customerName ?? project?.customerName ?? "-",
      contactPhone: "",
      productCode: "",
      productName: r.name,
      qty: r.qty ?? "",
      poId: null,
      reqDate: "",
      customerRequests: statement ? (requestsByProject.get(statement.projectId)?.join("; ") ?? "") : "",
      statementId: r.statementId,
      paidCash: statement?.paidCash ?? "",
      paidCard: statement?.paidCard ?? "",
      taxInvoiceIssuedAt: taxInvoiceByStatementId.get(r.statementId)?.toISOString().slice(0, 10) ?? "",
      cashReceiptIssuedAt: statement?.cashReceiptIssuedAt ?? "",
      cardReceiptIssuedAt: statement?.paidCard ? (statement.paidDate ?? "") : "",
      supplierName: "",
      supplierPhone: "",
      shipDate: "",
      outAmount: "",
      revenue,
      cost: null,
      profit: null,
      marginRate: null,
      overriddenFields: [],
      isHistorical: false,
    };
  });

  // 9. 과거 이력(historical_orders, Daily Summary 엑셀 이관) — 요청 시에만. 연결된
  // 프로젝트/견적/발주/명세서가 전혀 없어 quoteId/quoteItemId/poId/statementId 모두 null —
  // Summary/대시보드 편집 UI에서 이 값들로 편집 가능 여부를 판단하므로 이 행들은 자동으로
  // 읽기 전용이 된다. 앱 실사용 시작 시점(2026-08-20~)과 엑셀 마지막 기록 시점(~2026-08-31)이
  // 겹쳐 일부 행이 라이브 견적과 중복일 수 있다는 걸 사용자가 인지하고 있음(2026-09-03,
  // "전부 이관하고 제가 직접 확인/정리") — 그래서 필터링하지 않고 전부 넣는다.
  const historicalRows: SummaryRow[] = options?.includeHistorical
    ? (
        await db
          .select()
          .from(historicalOrders)
          .orderBy(historicalOrders.orderDate)
      ).map((h) => {
        const revenue = h.revenue != null ? Number(h.revenue) : null;
        const cost = h.cost != null ? Number(h.cost) : null;
        const profit = h.profit != null ? Number(h.profit) : revenue != null && cost != null ? revenue - cost : null;
        return {
          rowKey: `hist-${h.id}`,
          quoteId: null,
          quoteItemId: null,
          projectId: "",
          projectNumber: "-",
          orderDate: h.orderDate ?? "",
          contactName: h.contactName ?? "",
          customerName: h.customerName ?? "-",
          contactPhone: h.contactPhone ?? "",
          productCode: "",
          productName: h.productName ?? "-",
          qty: h.qty ?? "",
          poId: null,
          reqDate: "",
          customerRequests: "",
          statementId: null,
          paidCash: "",
          paidCard: "",
          taxInvoiceIssuedAt: "",
          cashReceiptIssuedAt: "",
          cardReceiptIssuedAt: "",
          supplierName: h.supplierName ?? "",
          supplierPhone: h.supplierPhone ?? "",
          shipDate: h.shipDate ?? "",
          outAmount: h.cost ?? "",
          revenue,
          cost,
          profit,
          marginRate: revenue ? (profit as number) / revenue : null,
          overriddenFields: [],
          isHistorical: true,
        };
      })
    : [];

  const allRows = [...quoteItemRows, ...orphanRows, ...orphanStatementRows, ...historicalRows];

  // 10. Summary 전용 정정값(summary_overrides) 적용 — 견적서/발주서/배송기록은 실제로
  // 고객·공급업체에 보낸 문서라 원본을 직접 고치지 않는다(2026-09-03). 값이 바뀌면 이
  // 테이블에 별도로 기록해두고, Summary/대시보드는 여기 값이 있으면 그걸로 덮어써서 보여준다.
  const overrideRows = allRows.length
    ? await db
        .select()
        .from(summaryOverrides)
        .where(
          inArray(
            summaryOverrides.rowKey,
            allRows.map((r) => r.rowKey)
          )
        )
    : [];
  const overrideByRowKey = new Map(overrideRows.map((o) => [o.rowKey, o]));

  return allRows.map((row) => applyOverride(row, overrideByRowKey.get(row.rowKey)));
}

function applyOverride(row: SummaryRow, o: typeof summaryOverrides.$inferSelect | undefined): SummaryRow {
  if (!o) return row;
  const overridden: string[] = [];
  const next = { ...row };
  if (o.orderDate) {
    next.orderDate = o.orderDate;
    overridden.push("orderDate");
  }
  if (o.contactName) {
    next.contactName = o.contactName;
    overridden.push("contactName");
  }
  if (o.customerName) {
    next.customerName = o.customerName;
    overridden.push("customerName");
  }
  if (o.contactPhone) {
    next.contactPhone = o.contactPhone;
    overridden.push("contactPhone");
  }
  if (o.productCode) {
    next.productCode = o.productCode;
    overridden.push("productCode");
  }
  if (o.productName) {
    next.productName = o.productName;
    overridden.push("productName");
  }
  if (o.qty) {
    next.qty = o.qty;
    overridden.push("qty");
  }
  if (o.reqDate) {
    next.reqDate = o.reqDate;
    overridden.push("reqDate");
  }
  if (o.supplierName) {
    next.supplierName = o.supplierName;
    overridden.push("supplierName");
  }
  if (o.supplierPhone) {
    next.supplierPhone = o.supplierPhone;
    overridden.push("supplierPhone");
  }
  if (o.shipDate) {
    next.shipDate = o.shipDate;
    overridden.push("shipDate");
  }
  next.overriddenFields = overridden;
  return next;
}
