import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

// html2canvas taints the canvas on cross-origin / uncached images, so — same as the
// original 온마음_문서생성기_통합.html prototype (LOGO/SEAL as base64 consts) — the logo
// and seal are inlined as data URIs rather than referenced by <img src="/branding/...">.
function toDataUrl(relativePath: string, mime: string) {
  const filePath = path.join(process.cwd(), "public", relativePath);
  const buffer = readFileSync(filePath);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

let cached: { logo: string; seal: string } | null = null;

export function getBrandAssets() {
  if (!cached) {
    cached = {
      logo: toDataUrl("branding/logo.jpg", "image/jpeg"),
      seal: toDataUrl("branding/seal.png", "image/png"),
    };
  }
  return cached;
}
