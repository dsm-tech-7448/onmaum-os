// 이미 다른 증빙이 있는 거래에는 세금계산서를 발행하지 않는다(이중 증빙 방지).
// - 카드 결제: 카드 매출전표가 영수증을 대신한다(2026-11-26).
// - 현금영수증: 이미 발행된 증빙(2026-10-19).
export function isCardPaid(paidCard: string | null | undefined): boolean {
  const amount = Number(paidCard ?? 0);
  return Number.isFinite(amount) && amount !== 0;
}

export function receiptBlockReason(statement: {
  paidCard: string | null;
  cashReceiptIssuedAt: string | null;
}): string | null {
  if (isCardPaid(statement.paidCard)) return "카드 결제됨";
  if (statement.cashReceiptIssuedAt) return `현금영수증 발행됨 (${statement.cashReceiptIssuedAt})`;
  return null;
}
