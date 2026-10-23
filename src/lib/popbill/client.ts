// popbill SDK(node_modules/popbill/index.js)는 순수 CJS 모듈이고 TaxinvoiceService()
// 등을 `this._TaxinvoiceService` 캐싱 패턴으로 구현한다. `import * as popbill from
// "popbill"`로 가져오면 번들러(webpack/Turbopack)가 ESM 네임스페이스 객체(스펙상
// non-extensible)로 감싸버려서 `this._TaxinvoiceService = ...` 대입이 조용히 무시되고,
// 그 결과 registIssue 호출 시 서비스 객체가 undefined로 읽혀 "Cannot read properties
// of undefined (reading 'registIssue')"가 난다(2026-09-22, 실제 세금계산서 발행
// 시도에서 발견 — serverExternalPackages를 추가해도 이 문제 자체는 안 고쳐졌다,
// 원인이 번들링 위치가 아니라 import 문법 자체였기 때문). require()로 직접 가져오면
// 원본 CJS exports 객체를 그대로 받아 this 캐싱이 정상 동작한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const popbill: typeof import("popbill") = require("popbill");

// 팝빌 연동 준비(2026-09-03) — 세금계산서 발행/카카오 알림톡 발송을 위한 공통 설정.
// 아직 실제 팝빌 계정(LinkID/SecretKey)과 사업자 인증, 알림톡 발신프로필/템플릿 사전승인이
// 없어도 앱이 정상 동작해야 하므로, 환경변수가 비어있으면 "설정 안 됨" 상태로 두고 호출
// 쪽에서 isPopbillConfigured()로 미리 확인해 건너뛴다(에러로 앱을 막지 않는다).
const LINK_ID = process.env.POPBILL_LINK_ID ?? "";
const SECRET_KEY = process.env.POPBILL_SECRET_KEY ?? "";
export const POPBILL_CORP_NUM = process.env.POPBILL_CORP_NUM ?? ""; // 하이픈 없는 10자리 사업자등록번호(우리 회사)
const IS_TEST = process.env.POPBILL_IS_TEST !== "false"; // 기본값 true — 실운영 전환 시 명시적으로 "false"로 설정

export function isPopbillConfigured(): boolean {
  return Boolean(LINK_ID && SECRET_KEY && POPBILL_CORP_NUM);
}

let configured = false;
function ensureConfigured() {
  if (configured || !isPopbillConfigured()) return;
  popbill.config({
    LinkID: LINK_ID,
    SecretKey: SECRET_KEY,
    IsTest: IS_TEST,
    IPRestrictOnOff: true,
    UseStaticIP: false,
    UseLocalTimeYN: true,
  });
  configured = true;
}

export function getTaxinvoiceService() {
  ensureConfigured();
  return popbill.TaxinvoiceService();
}

export function getKakaoService() {
  ensureConfigured();
  return popbill.KakaoService();
}
