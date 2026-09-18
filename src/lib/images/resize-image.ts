// 시안/견적 이미지는 base64로 인코딩해 Server Action 본문에 그대로 실어 보낸다. Vercel
// Functions는 요청 본문을 4.5MB로 하드 제한하고(플랫폼 레벨이라 next.config.ts로 못
// 늘린다), 휴대폰 사진 원본은 보통 그 이상이라 저장이 막혔다(2026-09-16). 업로드
// 즉시 화면 표시에 필요한 크기로 축소·재압축해서 원본 대신 이 결과를 쓴다.
export function resizeImageToDataUrl(
  file: File,
  { maxDimension = 1600, quality = 0.82 }: { maxDimension?: number; quality?: number } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("캔버스를 초기화할 수 없습니다."));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("이미지를 불러올 수 없습니다."));
    };
    img.src = objectUrl;
  });
}
