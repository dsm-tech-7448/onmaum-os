// 견적서/발주서/거래명세서/세금계산서 미리보기(.quote-doc 등)를 PNG로 내보낼 때 쓰는
// 공용 함수(2026-09-30) — 프린트했을 때 A4에 딱 맞게 최적화해달라는 요청.
//
// 문제: 기존엔 `scale = 2480 / node.offsetWidth`만 적용해서 너비만 300dpi A4(2480px)에
// 맞추고 높이는 내용 길이 그대로 뒀다. 미리보기 컨테이너는 `width: 794px; min-height:
// 1123px`(A4 96dpi 크기)라 품목 수가 적으면 우연히 A4 비율이 맞았지만, 품목이 많아
// min-height를 넘기면 실제 캡처된 이미지가 A4보다 세로로 길어졌다 — 그걸 실제 A4 용지에
// 인쇄하면 잘리거나 비율이 안 맞았다.
//
// 해결: 항상 정확히 2480×3508(A4, 300dpi) 픽셀의 PNG를 만든다. 너비/높이 중 더 빡빡한
// 쪽 비율로 전체를 캡처한 뒤, 흰 배경 A4 캔버스 정중앙에 그린다 — 내용이 min-height
// 이내면(대부분의 경우) 지금까지와 동일하게 꽉 차고, 내용이 넘치면 잘리는 대신 전체가
// 비례해서 줄어들어(좌우에 흰 여백) 한 장의 A4로 그대로 인쇄할 수 있다.
export const A4_PNG_WIDTH = 2480;
export const A4_PNG_HEIGHT = 3508;

export async function exportNodeAsA4Png(node: HTMLElement): Promise<Blob | null> {
  const { default: html2canvas } = await import("html2canvas");

  const scale = Math.min(A4_PNG_WIDTH / node.offsetWidth, A4_PNG_HEIGHT / node.offsetHeight);
  const captured = await html2canvas(node, {
    scale,
    backgroundColor: "#ffffff",
    useCORS: true,
    windowWidth: node.offsetWidth,
  });

  const a4Canvas = document.createElement("canvas");
  a4Canvas.width = A4_PNG_WIDTH;
  a4Canvas.height = A4_PNG_HEIGHT;
  const ctx = a4Canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, A4_PNG_WIDTH, A4_PNG_HEIGHT);
  const dx = Math.round((A4_PNG_WIDTH - captured.width) / 2);
  const dy = Math.round((A4_PNG_HEIGHT - captured.height) / 2);
  ctx.drawImage(captured, Math.max(dx, 0), Math.max(dy, 0));

  return new Promise((resolve) => a4Canvas.toBlob(resolve, "image/png"));
}
