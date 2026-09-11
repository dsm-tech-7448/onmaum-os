import {
  getProjectsByPendingStage,
  getUnsentDrafts,
  getUnpaidSuppliers,
  getMissingCustomerPayments,
  getOutstandingBalances,
  getPOsDueToday,
  getOverdueUnshippedPos,
  getProjectsMissingPO,
  getUpcomingPeakSeasonCustomers,
  type UpcomingPeakSeasonCustomer,
} from "./queries";
import { getSummaryRows, type SummaryRow } from "./summary-sheet";

// 대시보드는 "오늘 처리해야 할 일"의 개수만 보여준다 — 지나간 이력(최근 업무 로그)은
// 필요 없다는 사용자 결정(2026-09-03). 해당 항목을 처리(문서 저장/필드 입력)하면 그
// 즉시 이 숫자가 줄어드는 것이 이 화면의 전부다. 숫자는 기존 체크리스트 쿼리 함수들을
// 그대로 재사용해 집계만 다시 한다(새 쿼리 로직 중복 없음).
// 카드 구성(사용자가 명시적으로 요청한 7개 — 견적 발송/시안 발송/발주서 작성/거래명세서
// 발송/영수증 발행/배송/미입금, 2026-09-03 확정):
// - 견적 발송: 다음 단계가 "2. 견적 발송"인 프로젝트 (아직 견적을 못 보낸 것)
// - 시안 발송: getUnsentDrafts() (시안은 작성됐지만 "고객에게 발송" 안 누른 것)
// - 발주서 작성: 발주서가 아예 없는 활성 프로젝트 (getProjectsMissingPO — 거래명세서를
//   발주보다 먼저 보내는 경우가 있어 "다음 단계=5"로는 못 잡는다, 2026-09-03)
// - 거래명세서 발송: 다음 단계가 "6. 거래명세서 발송"인 프로젝트
// - 영수증 발행: 다음 단계가 "7. 영수증 발행"인 프로젝트
// - 배송: 발송요청일이 오늘이거나 지난 미배송 발주 (getPOsDueToday/getOverdueUnshippedPos)
// - 미입금: 고객 미입금(결제 미입력 또는 미수금 남음, 명세서 기준 합집합)
// - 미출금: 공급업체에 아직 입금하지 않은 발주 (getUnpaidSuppliers) — 2026-09-03, 원래
//   "미입금" 하나로 합쳐뒀던 걸 방향이 반대라 헷갈린다는 피드백으로 분리했다.
// 3~4단계(시안 작성중/시안 확정 대기)는 사용자가 요청한 6개 항목에 없어 카드가 없다.
export type SummaryCounts = {
  quoteSent: number;
  draftSent: number;
  poPending: number;
  statementPending: number;
  receiptPending: number;
  shippingDue: number;
  unpaidCustomer: number;
  unpaidSupplier: number;
};

// 주간/월간 매입·매출·건수 — Summary 장표(getSummaryRows)를 그대로 재집계한다("대시보드는
// Summary 데이터 기준" 원칙, 2026-09-03과 동일하게 별도 계산 로직을 만들지 않는다). 기준
// 날짜는 Summary의 "날짜"(견적일자, 정정값 있으면 정정값)다 — 상세 페이지들과 마찬가지로
// orderDate가 없는(orphan 발주/명세서) 행은 기간 집계에서 제외된다.
// SummaryRow.revenue/cost/profit은 공급가 기준(부가세 미포함) — Summary 장표 자체는 그대로
// 두고, 대시보드에 "보여줄 때"만 부가세 10%를 더한다(2026-09-10 피드백: "대시보드에서
// 나오는 금액은 모두 부가세포함으로 적용해 줘"). 미수금(outstandingTotal)은 수기 입력값이라
// 이미 실제 받아야 할 금액(부가세 포함) 그대로이므로 여기서는 건드리지 않는다.
const VAT_RATE = 0.1;
function withVat(supply: number): number {
  return Math.round(supply * (1 + VAT_RATE));
}

export type PeriodStat = {
  revenue: number; // 부가세 포함
  cost: number; // 부가세 포함
  profit: number; // 부가세 포함 매출액 - 부가세 포함 매입액
  count: number;
};

export type DashboardPeriodStats = {
  week: PeriodStat;
  month: PeriodStat;
  weekLabel: string; // "09/01 ~ 09/07" 형태
  monthLabel: string; // "2026년 9월" 형태
  outstandingTotal: number; // 미수금 합계 — 매 페이지 로드마다 실시간 재계산(캐시 없음)이라 "매일 업데이트"가 항상 참이다.
};

function toMD(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${m}/${d}`;
}

function getWeekRange(today: Date): { start: string; end: string } {
  const day = today.getDay(); // 0=일 ... 6=토
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

function getMonthRange(today: Date): { start: string; end: string } {
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function sumPeriod(rows: SummaryRow[], start: string, end: string): PeriodStat {
  const inRange = rows.filter((r) => r.orderDate && r.orderDate >= start && r.orderDate <= end);
  const revenue = withVat(inRange.reduce((sum, r) => sum + (r.revenue ?? 0), 0));
  const cost = withVat(inRange.reduce((sum, r) => sum + (r.cost ?? 0), 0));
  return {
    revenue,
    cost,
    profit: revenue - cost,
    count: inRange.length,
  };
}

// 아래는 일부러 Promise.all이 아니라 순차 await다 — getSummaryRows() 하나가 이미
// quotes/quote_items/purchase_orders/production/statement_items/transaction_statements/
// tax_invoices/project_requests/summary_overrides를 다 조회하는 무거운 함수라, 이걸 포함해
// 9개를 한꺼번에 동시 실행하면 Supabase 풀러(Supavisor) 동시 연결 수를 순간적으로 크게
// 넘겨서 커넥션이 멈추는 문제가 실제로 재현됐다(2026-09-03, project_dev_server_hangs 메모
// 참고 — 이번엔 락이 아니라 순수 동시 부하였다). 이 화면은 실시간성이 중요한 화면이 아니라
// 순차 실행으로 늘어나는 몇백ms는 안정성과 바꿀 만하다.
export async function getDashboardSummary(): Promise<{
  counts: SummaryCounts;
  period: DashboardPeriodStats;
  upcomingPeakSeason: UpcomingPeakSeasonCustomer[];
}> {
  const pendingGroups = await getProjectsByPendingStage();
  const unsentDrafts = await getUnsentDrafts();
  const unpaidSuppliers = await getUnpaidSuppliers();
  const missingPayments = await getMissingCustomerPayments();
  const outstanding = await getOutstandingBalances();
  const poDueToday = await getPOsDueToday();
  const poOverdue = await getOverdueUnshippedPos();
  const missingPO = await getProjectsMissingPO();
  const summaryRows = await getSummaryRows();
  const upcomingPeakSeason = await getUpcomingPeakSeasonCustomers();

  const countByStage = (sortOrder: number) =>
    pendingGroups.filter((g) => g.stageSortOrder === sortOrder).reduce((sum, g) => sum + g.projects.length, 0);

  const shippingDue = poDueToday.length + poOverdue.length;

  const unpaidStatementKeys = new Set<string>();
  for (const m of missingPayments) unpaidStatementKeys.add(m.statementNumber);
  for (const o of outstanding) unpaidStatementKeys.add(o.statementNumber);

  const counts: SummaryCounts = {
    quoteSent: countByStage(2),
    draftSent: unsentDrafts.length,
    poPending: missingPO.length,
    statementPending: countByStage(6),
    receiptPending: countByStage(7),
    shippingDue,
    unpaidCustomer: unpaidStatementKeys.size,
    unpaidSupplier: unpaidSuppliers.length,
  };

  const today = new Date();
  const weekRange = getWeekRange(today);
  const monthRange = getMonthRange(today);

  const period: DashboardPeriodStats = {
    week: sumPeriod(summaryRows, weekRange.start, weekRange.end),
    month: sumPeriod(summaryRows, monthRange.start, monthRange.end),
    weekLabel: `${toMD(weekRange.start)} ~ ${toMD(weekRange.end)}`,
    monthLabel: `${today.getFullYear()}년 ${today.getMonth() + 1}월`,
    outstandingTotal: outstanding.reduce((sum, o) => sum + o.outstandingAmount, 0),
  };

  return { counts, period, upcomingPeakSeason };
}
