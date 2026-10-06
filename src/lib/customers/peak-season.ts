import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { historicalOrders, customers } from "@/db/schema";

// 고객별 "개인 성수기"(peak_season_month) 계산 — 온마음OS_시즌분석_고객등급_알림전략.md의
// 설계를 그대로 구현한다: Daily Summary 이력(historical_orders, 기준정보)을 고객명으로
// 묶어서 월별 주문건수를 세고, 가장 많은 달을 그 고객의 개인 성수기로 저장한다.
// "매 분기 또는 매월 배치로 재계산" 하라고 문서에 적혀 있어 — 예약 실행 인프라가 아직
// 없어서 당장은 scripts/compute-peak-season.ts로 수동/주기적 실행하는 배치 함수로 둔다.
export type PeakSeasonResult = { customersUpdated: number; customersConsidered: number };

export async function recomputePeakSeasonMonths(): Promise<PeakSeasonResult> {
  const rows = await db
    .select({ customerName: historicalOrders.customerName, orderDate: historicalOrders.orderDate })
    .from(historicalOrders)
    .where(and(isNotNull(historicalOrders.customerName), isNotNull(historicalOrders.orderDate)));

  // 고객명 -> 1~12월 건수
  const monthCounts = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.customerName || !r.orderDate) continue;
    const month = Number(r.orderDate.slice(5, 7));
    if (month < 1 || month > 12) continue;
    const counts = monthCounts.get(r.customerName) ?? new Array(13).fill(0);
    counts[month] += 1;
    monthCounts.set(r.customerName, counts);
  }

  for (const [customerName, counts] of monthCounts) {
    let peakMonth = 0;
    let peakCount = 0;
    for (let m = 1; m <= 12; m++) {
      if (counts[m] > peakCount) {
        peakCount = counts[m];
        peakMonth = m;
      }
    }
    if (peakMonth === 0) continue;

    await db.update(customers).set({ peakSeasonMonth: peakMonth }).where(eq(customers.companyName, customerName));
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customers)
    .where(isNotNull(customers.peakSeasonMonth));

  return { customersUpdated: count, customersConsidered: monthCounts.size };
}
