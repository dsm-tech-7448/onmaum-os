import * as popbill from "popbill";

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
