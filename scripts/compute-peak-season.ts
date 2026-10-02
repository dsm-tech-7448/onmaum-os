// 고객별 개인 성수기(peak_season_month) 재계산 배치 — Daily Summary 이력(historical_orders)
// 기준으로 다시 계산해 customers 테이블에 저장한다. 예약 실행 인프라가 없어서 지금은
// 수동/주기적으로 이 스크립트를 실행한다(온마음OS_시즌분석_고객등급_알림전략.md 문서의
// "매 분기 또는 매월 배치로 재계산" 권장 사항).
import { recomputePeakSeasonMonths } from "../src/lib/customers/peak-season";

async function main() {
  const result = await recomputePeakSeasonMonths();
  console.log(`개인 성수기 재계산 완료 — 대상 고객 ${result.customersConsidered}명, 저장됨 ${result.customersUpdated}명`);
  process.exit(0);
}

main().catch((error) => {
  console.error("개인 성수기 재계산 실패:", error);
  process.exit(1);
});
