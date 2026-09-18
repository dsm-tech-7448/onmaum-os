import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 시안/견적 이미지는 base64로 인코딩해 Server Action 본문에 그대로 실어 보낸다
    // (2026-09-16) — 기본 1MB 제한에서는 휴대폰 사진 한 장만 첨부해도 "Body exceeded
    // 1 MB limit" 에러(React 오류 #441로 뭉뚱그려져 화면엔 표시됨)가 났다.
    serverActions: {
      bodySizeLimit: "25mb",
    },
    // Next.js 16의 proxy 계층이 요청 본문을 기본 10MB까지만 버퍼링하고 나머지는
    // 자른다(서버 액션의 bodySizeLimit과는 별개 설정) — 이 값도 함께 올려주지 않으면
    // 이미지가 10MB를 넘는 순간 JSON이 잘려서 "Unterminated string in JSON" 에러가 난다.
    //
    // 그래도 실제 상한은 이 둘이 아니라 Vercel Functions 자체의 요청 본문 4.5MB
    // 하드 제한이다(플랫폼 레벨이라 next.config.ts로 못 늘리고, 초과하면
    // "An unexpected response was received from the server"로만 나온다). 그래서
    // 위 두 값은 안전 여유일 뿐이고, 실질적인 대응은 업로드 시 이미지를 축소·재압축해
    // 웬만하면 몇백 KB 안으로 줄이는 쪽이다 — src/lib/images/resize-image.ts 참고.
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;
