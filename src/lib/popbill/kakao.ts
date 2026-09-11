import { getKakaoService, isPopbillConfigured, POPBILL_CORP_NUM } from "./client";

const ALIMTALK_SENDER = process.env.POPBILL_ALIMTALK_SENDER ?? ""; // 발신프로필(플러스친구) ID
const SHIPPING_TEMPLATE_CODE = process.env.POPBILL_ALIMTALK_SHIPPING_TEMPLATE_CODE ?? ""; // 배송일정안내 승인템플릿 코드

export type AlimtalkResult = { ok: true; receiptNum: string } | { ok: false; error: string };

export function isAlimtalkConfigured(): boolean {
  return isPopbillConfigured() && Boolean(ALIMTALK_SENDER && SHIPPING_TEMPLATE_CODE);
}

// 배송일정안내 알림톡 1건 발송 — content는 카카오에 사전승인된 템플릿 문구와 정확히
// 일치해야 한다(변수 치환만 가능, 자유 문구 불가). 템플릿이 아직 승인되지 않았으면
// isAlimtalkConfigured()가 false를 반환하므로 호출 쪽에서 건너뛴다.
export async function sendShippingAlimtalk(params: {
  content: string;
  altContent: string; // 알림톡 전송 실패 시 대체발송할 SMS/LMS 문구
  receiver: string; // 수신번호(하이픈 없이)
  receiverName: string;
}): Promise<AlimtalkResult> {
  if (!isAlimtalkConfigured()) {
    return { ok: false, error: "알림톡 연동 설정(발신프로필/템플릿코드)이 안 되어 있습니다." };
  }

  const service = getKakaoService();

  return new Promise<AlimtalkResult>((resolve) => {
    service.sendATS_one(
      POPBILL_CORP_NUM,
      SHIPPING_TEMPLATE_CODE,
      ALIMTALK_SENDER,
      params.content,
      "배송 안내",
      params.altContent,
      "C", // 실패 시 문자(SMS/LMS)로 대체발송
      null,
      params.receiver.replace(/-/g, ""),
      params.receiverName,
      null,
      null,
      null,
      null,
      (receiptNum) => resolve({ ok: true, receiptNum }),
      (error) => resolve({ ok: false, error: `[${error.code}] ${error.message}` })
    );
  });
}
