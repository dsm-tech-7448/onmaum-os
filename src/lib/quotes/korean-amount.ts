// 온마음_문서생성기_통합.html의 numberToKorean/fmt/num을 그대로 포팅.
export function num(v: unknown): number {
  const n = typeof v === "string" ? Number.parseFloat(v) : Number(v);
  return Number.isNaN(n) ? 0 : n;
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

export function numberToKorean(nInput: number): string {
  let n = Math.round(nInput);
  if (n === 0) return "영원";

  const digits = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const small = ["", "십", "백", "천"];
  const big = ["", "만", "억", "조", "경"];

  let result = "";
  let gi = 0;
  while (n > 0) {
    const group = n % 10000;
    if (group > 0) {
      let gs = "";
      let g = group;
      for (let p = 0; p < 4; p++) {
        const d = g % 10;
        if (d > 0) gs = digits[d] + small[p] + gs;
        g = Math.floor(g / 10);
      }
      result = gs + big[gi] + result;
    }
    n = Math.floor(n / 10000);
    gi++;
  }
  return result + "원";
}
