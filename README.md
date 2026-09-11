# 온마음 OS

Next.js(App Router) + PostgreSQL(Drizzle ORM) 기반 온마음기프트 내부 업무 시스템.
스키마 기준 문서: [`../온마음OS_마스터_DB스키마_v3.md`](../온마음OS_마스터_DB스키마_v3.md)

## 전체 요약 — 지금까지 만든 테이블 · 화면 (2026-08-19 기준)

다음에 다시 시작할 때 한눈에 보기 위한 요약. 자세한 내용은 각 절(테이블은 아래 기능별
섹션, 화면은 `구조` 섹션)을 참고. 8단계 핵심 프로세스(고객 문의 → 견적 → 시안작성 →
시안확정 → 공급처발주 → 거래명세서발송 → 세금계산서발행 → 배송일정안내)는 전 구간
end-to-end로 구현·검증 완료.

### DB 테이블

| 테이블 | 용도 |
|---|---|
| `company_profile` | 자사 정보(상호/사업자번호/로고/직인/계좌) — 문서에 자동으로 채워짐 |
| `users` | 관리자 로그인 계정 (bcrypt 해시) |
| `customers` | 고객사 마스터 (등급/휴면 플래그는 시드 시점 스냅샷) |
| `suppliers` | 협력업체(공급처) 마스터 |
| `project_stages` | 8단계 진행 단계 고정 정의 |
| `projects` | 프로젝트(주문 건) — `current_stage_id`, `requires_draft` 등 |
| `project_stage_log` | 프로젝트가 각 단계를 통과한 이력 |
| `option_master` | 견적서 옵션명 자동완성 마스터 |
| `product_suggestions` | 견적서 품명 자동완성(사용 시 자동 누적) |
| `quotes` / `quote_tiers` / `quote_items` | 견적서 — 리비전(append-only), 수량구간 비교견적 |
| `drafts` / `draft_images` | 시안 — 리비전 + 이미지, 리비전 하나를 "확정" 가능 |
| `purchase_orders` / `po_items` | 발주서 — 리비전, 직인 없음 |
| `transaction_statements` / `statement_items` | 거래명세서 — 리비전 없음(1회성), 직인 있음 |
| `tax_invoices` / `tax_invoice_items` | 세금계산서 — 요청→확인→발행 3단계, 홈택스 연동 자리만 |
| `production` | 제작·배송 현황(택배사/송장번호/제작단계), 프로젝트당 여러 행(분할배송) |
| `notification_log` | 발송 알림 이력 — 지금은 카카오/문자 실연동 없이 "생성"까지만 |

### 화면 / 라우트

| 라우트 | 설명 | 게이트 조건 |
|---|---|---|
| `/login` | 로그인 | — |
| `/dashboard` | 로그인 후 진입점, company_profile 표시 | — |
| `/projects` | 프로젝트 목록, 8단계 색상 시각화 | — |
| `/projects/new` | 프로젝트 생성 (고객 검색 + 번호 자동생성) | — |
| `/projects/[id]` | 상세 레이아웃 — 헤더(현재/다음 단계) + 탭바 | — |
| `/projects/[id]/quotes` | 견적서 작성 | — (항상 가능) |
| `/projects/[id]/drafts` | 시안 작성 | `requires_draft=true`인 프로젝트에만 탭 노출 |
| `/projects/[id]/purchase-orders` | 발주서 작성 | 시안확정(또는 requires_draft=false면 견적발송) 이후 |
| `/projects/[id]/transaction-statements` | 거래명세서 발송 | "5. 공급처 발주" 완료 이후 |
| `/projects/[id]/tax-invoices` | 세금계산서 발행(요청→확인→발행) | "6. 거래명세서 발송" 완료 이후 |
| `/projects/[id]/production` | 제작·배송 현황 + 알림 로그 | 탭은 항상 열림, **송장번호 등록만** "7. 세금계산서 발행" 완료 이후 |

### 아직 안 만든 것 (다음 후보)

`온마음OS_마스터_DB스키마_v3.md`의 payments, supplier_payments, ai_consultations,
automation_settings 등. 자세한 설계 메모는 이 문서 맨 아래 [다음 단계](#다음-단계) 참고.

## 시작하기

```bash
npm install
cp .env.example .env.local
```

`.env.local`에 최소 `AUTH_SECRET`을 채워야 로그인이 동작합니다 (랜덤 생성):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`DATABASE_URL`이 비어 있어도 앱은 정상적으로 뜨고 로그인 화면까지 확인할 수 있습니다.
단, 실제 로그인은 DB에 연결되어야 성공합니다 (연결 안 되면 화면에 안내 메시지가 뜹니다).

```bash
npm run dev
```

## DB 연결 후 (Supabase 등)

Supabase는 direct connection(`db.xxx.supabase.co:5432`)이 IPv6 전용이라 로컬 환경에 따라
막힐 수 있습니다. 대신 Pooler를 쓰되, **두 개의 URL을 분리**해야 합니다:

- `DATABASE_URL` — **Transaction pooler**(포트 6543). 앱 런타임용.
- `DATABASE_URL_MIGRATIONS` — **Session pooler**(포트 5432). `drizzle-kit` 전용.
  Transaction pooler는 advisory lock 같은 세션 단위 기능을 지원하지 않아
  `db:push`/`db:generate`가 응답 없이 멈춥니다 — 반드시 Session pooler를 따로 지정하세요.

1. `.env.local`에 위 두 URL을 채운다 (Supabase 대시보드 → Project Settings → Database → Connection string)
2. 스키마를 DB에 반영:
   ```bash
   npm run db:push
   ```
3. 기준정보 시드 (순서대로):
   ```bash
   npm run db:seed                      # company_profile + 관리자 계정 (ADMIN_EMAIL/ADMIN_PASSWORD 필요)
   npm run db:seed-project-stages       # 8단계 진행 단계 정의
   npm run db:seed-customers-suppliers  # 고객/공급업체 (../온마음OS_고객공급업체_시드데이터.xlsx)
   npm run db:seed-option-master        # 옵션 마스터 초기값 (견적서 자동완성용)
   ```
4. `npm run dev` 실행 후 `/login`에서 관리자 계정으로 로그인 확인

## 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run db:generate` | 스키마 변경사항으로 마이그레이션 파일 생성 |
| `npm run db:push` | 스키마를 DB에 직접 반영 (초기 단계용) |
| `npm run db:studio` | Drizzle Studio (DB GUI) |
| `npm run db:seed` | company_profile + 관리자 계정 시드 |
| `npm run db:reset-admin-password` | `.env.local`의 ADMIN_EMAIL/ADMIN_PASSWORD로 관리자 비밀번호 재설정 |
| `npm run db:seed-project-stages` | 8단계 project_stages 정의 시드 |
| `npm run db:seed-customers-suppliers` | 고객/공급업체 엑셀 시드데이터 임포트 |
| `npm run db:seed-option-master` | option_master 초기값 시드 (온마음_문서생성기_통합.html 기본 옵션 목록) |

## 구조

```
src/
  db/
    schema.ts      # company_profile, users, customers, suppliers, projects,
                     # project_stages, project_stage_log, quotes, quote_items,
                     # quote_tiers, option_master, product_suggestions,
                     # drafts, draft_images, purchase_orders, po_items,
                     # transaction_statements, statement_items,
                     # tax_invoices, tax_invoice_items,
                     # production, notification_log
    index.ts        # Drizzle 클라이언트 (앱 런타임, Transaction pooler)
  lib/auth/
    password.ts      # bcrypt 해싱
    session.ts        # JWT 세션 쿠키 발급/검증
  lib/quotes/
    quote-number.ts   # QT-YYYYMMDD-#### 자동 생성
    korean-amount.ts  # 금액 → 한글 표기 ("일십사만오천이백원")
    brand-assets.ts   # 로고/직인을 base64 data URI로 (html2canvas 캡처용)
    blank-draft.ts    # 빈 견적 초기 상태
    types.ts          # QuoteDraft 등 에디터 공유 타입
  lib/projects/
    project-number.ts     # PJ-연도-#### 자동 생성
    stage-transition.ts    # 단계 자동전환(advanceProjectStage) + 선행조건 검사
                             # (assertProjectReachedStage) + 다음 단계 계산(getNextStage)
  lib/purchase-orders/
    po-number.ts       # PO-YYYYMMDD-#### 자동 생성
    blank-draft.ts       # 빈 발주서 초기 상태 (특기사항 기본 문구 포함)
    types.ts              # PoDraft 등 — po_items는 QuoteItemDraft를 그대로 재사용
  lib/transaction-statements/
    statement-number.ts  # TX-YYYYMMDD-#### 자동 생성 (리비전 없어 전역 유일)
    blank-draft.ts         # 빈 거래명세서 초기 상태
    types.ts                # StatementDraft 등 — statement_items도 QuoteItemDraft 재사용
  lib/tax-invoices/
    invoice-number.ts    # TI-YYYYMMDD-#### 자동 생성
    blank-draft.ts         # 빈 세금계산서 초기 상태
    types.ts                # TaxInvoiceDraft, status(requested/confirmed/issued) 등
  lib/production/
    types.ts              # PRODUCTION_STAGES(발주완료~납품완료 8단계), ProductionDraft 등
  components/
    stage-progress.tsx  # 8단계 진행 상황 색상 표시
    quote/               # 견적서 미리보기(A4) + 품목행/구간 에디터 (po/statement/tax-invoice에서도 재사용)
    po/                   # 발주서 미리보기(A4, 직인 없음) + 공급업체 검색
    statement/             # 거래명세서 미리보기(A4, 직인 있음)
    tax-invoice/            # 세금계산서 미리보기(A4, 직인 있음, 품목별 공급가액/세액 컬럼)
  app/
    login/            # 로그인 화면 + 서버 액션
    dashboard/         # 로그인 후 진입점 (company_profile 표시)
    projects/new/      # 프로젝트 생성 (고객 검색 + 프로젝트번호 자동생성)
    projects/[id]/      # 프로젝트 상세 레이아웃(헤더+탭)
      quotes/            # 견적서 작성 탭
      drafts/             # 시안 작성 탭 (requires_draft=true일 때만 노출)
      purchase-orders/     # 발주서 작성 탭 (선행 단계 미도달 시 안내만 표시)
      transaction-statements/ # 거래명세서 발송 탭 (선행 단계 미도달 시 안내만 표시)
      tax-invoices/            # 세금계산서 발행 탭 (선행 단계 미도달 시 안내만 표시)
      production/               # 제작·배송 탭 (탭 자체는 항상 열림 — 아래 설명 참고)
  proxy.ts             # 라우트 보호 (Next.js 16의 middleware → proxy)
scripts/
  seed.ts                        # company_profile + 관리자 계정
  reset-admin-password.ts         # 관리자 비밀번호 재설정
  seed-project-stages.ts          # 8단계 project_stages
  seed-customers-suppliers.ts     # 고객/공급업체 엑셀 임포트
  seed-option-master.ts           # 옵션 마스터 초기값
```

## 8단계 프로세스 추적

`project_stages`(고정 8단계 정의) + `projects.current_stage_id`(현재 단계) +
`project_stage_log`(단계 통과 이력)로 구성됩니다.
`projects.requires_draft = false`면 시안작성(3)/시안확정(4) 단계를 건너뜁니다
(물티슈·완제품 등 별도 인쇄가 없는 상품 — 온마음OS_마스터_DB스키마_v3.md 참고).

`current_stage_id`는 DB 기본값이 없습니다(컬럼 기본값은 다른 테이블을 조회할 수 없음) —
`/projects/new`의 서버 액션이 `project_stages`의 `inquiry` id를 조회해 채우고,
동시에 `project_stage_log`에 첫 이력을 기록합니다.

**자동 전환**: 견적을 처음 저장하면(`saveQuote` → `advanceProjectStage(projectId, "quote", ...)`)
현재 단계가 "2. 견적 발송"보다 앞이면 그 단계로 옮기고 `project_stage_log`에 기록합니다.
이미 도달했거나 더 진행된 상태면 리비전을 몇 번을 더 저장해도 멱등하게 아무 일도 하지
않습니다(중복 로그·역행 없음). `getNextStage()`는 `requires_draft`에 따라 시안 두 단계를
건너뛰고 다음 단계를 계산해 프로젝트 헤더에 "다음 단계: N. 이름"으로 표시합니다.
견적 저장 이후 화면이 최신 단계를 보여주도록 `QuoteEditor`가 저장 성공 시
`router.refresh()`를 호출합니다(서버 액션이 상태를 바꿔도 이미 렌더된 서버 컴포넌트
헤더는 자동으로 갱신되지 않기 때문).

## 견적서 (quotes)

`/projects/[id]/quotes` 탭 — 온마음_문서생성기_통합.html 프로토타입의 견적서 기능을 재현:

- **3가지 모드**: 단일 상품 / 복수 품목(구조는 동일, UI 프리셋만 다름) / 수량구간 비교견적.
  비교견적은 `quote_tiers`로 구간을 나누고 구간마다 독립적인 `quote_items`를 가진다
  (수량이 늘수록 인쇄비는 내려가고 배송비는 올라가는 식으로 구간별 옵션 구성이 달라질 수 있음).
- **리비전 관리**: "저장"은 항상 새 행을 INSERT — 같은 `(project_id, quote_number)`에
  리비전이 쌓이고 과거 리비전은 절대 수정되지 않는다. 리비전 이력에서 언제든 불러오기 가능.
- **가변 라인아이템**: `quote_items.line_type`으로 품목/옵션 줄을 구분하고, ▲▼로 순서를
  바꾸면 `sort_order`에 그대로 반영된다.
- **자동완성 + 자동누적**: 품명/옵션명 입력 필드는 `option_master`+`product_suggestions`를
  합친 datalist로 자동완성되고, 저장 시 새 이름은 `line_type`에 따라 두 테이블 중 하나에
  자동으로 쌓인다(usage_count 증가).
- **A4 미리보기 + PNG 저장**: `html2canvas`로 `.quote-doc`(A4 비율, 794×1123px)을 캡처해
  PNG로 저장. 로고/직인은 CORS 문제를 피하려고 서버에서 base64 data URI로 인라인한다
  (`lib/quotes/brand-assets.ts`) — html2canvas가 `position:relative` 오버랩 레이아웃에서
  텍스트를 잘못 배치하는 걸 겪어서, 직인 겹침은 `margin-left` 음수값 방식으로 처리했다.
- **한글 금액**: `numberToKorean()`이 "일십사만오천이백원" 형식으로 변환 (숫자 자릿수를
  그대로 읽는 프로토타입의 표기 방식을 그대로 포팅).

## 시안 (drafts)

`/projects/[id]/drafts` 탭 — `requires_draft=true`인 프로젝트에만 탭이 노출된다
(false면 탭 자체가 안 보이고, URL로 직접 들어가도 안내 문구만 표시).

- quotes와 같은 리비전 모델: "저장"은 항상 새 `drafts` 행을 INSERT, 과거 리비전은 수정 안 함.
  한 리비전에 여러 장의 이미지를 붙일 수 있다(`draft_images`, 캡션 포함).
- "이 시안 저장"은 프로젝트를 "3. 인쇄 시안 작성중"으로 전환한다(`advanceProjectStage`).
- 리비전 중 하나를 "이 리비전으로 확정"하면 그 행의 `is_confirmed`가 켜지고(프로젝트당 최대
  1개만 유지 — 재확정 시 이전 확정은 자동 해제) 프로젝트가 "4. 고객 시안 확정"으로 전환된다.
- 이미지도 quotes와 동일하게 base64 data URL로 저장한다(`draft_images.image_data_url`) —
  별도 오브젝트 스토리지 없이 동작하도록 한 임시 방편, 실사용 규모가 커지면 Supabase
  Storage 등으로 옮기는 게 좋다.

## 발주서 (purchase_orders)

`/projects/[id]/purchase-orders` 탭 — 온마음_문서생성기_통합.html의 발주서 기능을 재현:

- quotes와 같은 리비전 모델. 공급자는 `suppliers`에서 검색해 선택(`supplier_id` 저장)하거나
  새 업체명을 자유 입력(그 경우 `supplier_id`는 null, `supplier_name`만 스냅샷) — 자유 입력한
  이름은 quotes의 option_master/product_suggestions와 달리 suppliers에 자동으로 쌓지 않는다
  (suppliers는 실제 거래 이력 기반 마스터라 임시 입력으로 오염시키지 않으려는 의도).
- `po_items`는 `quote_items`와 완전히 같은 구조라 `QuoteItemDraft`/`ItemRowsEditor`를 그대로
  재사용한다(코드 중복 없음).
- 공급받는자(자사) 정보는 company_profile에서 자동으로 채워진다. **직인은 찍지 않는다**
  (발주서는 원래 프로토타입에서도 무인 — 견적서/거래명세서와 다름).
- **선행 단계 검사**: "견적 없이 발주부터 만드는 경우는 없다"는 전제로,
  `assertProjectReachedStage()`가 저장 액션 맨 앞에서 현재 단계를 확인한다.
  `requires_draft=true`면 "4. 고객 시안 확정" 이후, `false`면 "2. 견적 발송" 이후에만
  저장을 허용 — 조건을 못 채우면 에러를 던진다. 페이지 자체도 서버 컴포넌트에서 같은 조건을
  먼저 확인해 미달이면 에디터 대신 안내 문구만 보여준다(폼을 다 채운 뒤 저장 시점에야
  막히는 나쁜 UX를 피하려고 페이지 게이트 + 액션 가드를 이중으로 둠).
- 저장 성공 시 프로젝트를 "5. 공급처 발주"로 전환한다.

## 거래명세서 (transaction_statements)

`/projects/[id]/transaction-statements` 탭 — 온마음_문서생성기_통합.html의 거래명세서 기능을
재현. **리비전 개념이 없다**: 프로토타입에 거래명세서용 "저장"/이력 UI 자체가 아예 없고
(견적서·발주서만 있음), 실제로도 한 번 발송하면 끝나는 문서라는 업무 방식과 맞아서 확인 후
그대로 반영했다 — `transaction_statements`는 리비전 컬럼도, `(project, number, revision)`
유니크 제약도 없이 `statement_number` 자체가 전역 유일하다. 저장은 항상 새 행을 만들 뿐
수정/재저장 API가 없다(분할 출고 등 새로 보낼 게 있으면 새 번호로 별도 문서를 또 만든다).

- **발주서 품목 가져오기**: 프로젝트에 저장된 `purchase_orders`(각 po_number의 최신 리비전)
  목록에서 "불러오기"를 누르면 그 발주서의 `po_items`를 그대로 복사해온다
  (`purchase_order_id`로 출처를 기록) — 새로 입력할 필요 없음.
- 공급자(자사) 정보는 company_profile에서 자동 채움. **직인 포함** — "상호" 셀에
  `position:relative` 부모 + `position:absolute` 자식으로 겹쳐 걸치는, 프로토타입 원본과
  같은 방식을 그대로 썼고 html2canvas 캡처에서도 문제없이 렌더링되는 것까지 확인했다
  (quotes의 직인은 `margin-left` 음수값 방식을 쓴 것과 다름 — 그쪽은 다른 레이아웃 조합에서
  캡처 아티팩트를 겪었던 이력이 있어 더 안전한 방식으로 바꿔둔 것).
- 입금계좌 안내는 company_profile의 은행명/계좌번호/예금주를 그대로 조합해서 보여준다.
- 저장(발송) 시 `assertProjectReachedStage(projectId, "supplier_ordered")`로 "5. 공급처
  발주" 완료 여부를 확인한 뒤 `advanceProjectStage(projectId, "statement_sent", ...)`를
  호출한다 — 페이지 자체도 같은 조건으로 먼저 게이트를 건다(발주서와 동일한 패턴).

## 세금계산서 (tax_invoices)

`/projects/[id]/tax-invoices` 탭. 자동발행이 아니라 **"발행 요청 → 확인 → 발행"** 3단계
흐름으로 만들었다 — `status`(`requested`/`confirmed`/`issued`) 컬럼과 각 단계 버튼
("1️⃣ 발행 요청" → "2️⃣ 확인 처리" → "3️⃣ 발행 완료 처리")이 정확히 대응한다.

- **거래명세서 연결**: 아직 `tax_invoice_id`가 안 붙은 `transaction_statements`만 가져오기
  목록에 뜬다. "불러오기"로 고객명+`statement_items`를 복사해오고, "발행 요청"을 누르는
  순간 `tax_invoices` 행을 만들면서 원본 거래명세서의 `tax_invoice_id`를 채워
  연결한다(온마음OS_마스터_DB스키마_v3.md에 설계된 그대로 — FK는 `transaction_statements`
  쪽에 있고, `tax_invoices`가 나중에 붙는 구조).
- 공급자(자사)는 company_profile 자동 채움, 공급받는자는 거래명세서에서 가져온 고객명.
  직인 포함(거래명세서와 같은 `position:relative`+`absolute` 방식).
- 품목 테이블은 실제 세금계산서 양식처럼 공급가액/세액을 줄마다 따로 보여준다(거래명세서는
  합계에서만 부가세를 보여줬던 것과 다름).
- **홈택스 연동 자리만**: `hometax_sent` boolean 컬럼만 두고 팝빌/바로빌 등 실제 API 연동은
  아직 안 함 — 나중에 이 필드를 실제 전송 상태와 동기화하면 된다.
- 프로젝트 단계 전환은 **"발행 완료" 시점에만** 일어난다(`issueTaxInvoice` →
  `advanceProjectStage(projectId, "tax_invoice_issued", ...)`) — 요청/확인 단계에서는
  단계가 그대로 유지된다. `assertProjectReachedStage(projectId, "statement_sent")`로
  "6. 거래명세서 발송" 완료 여부를 먼저 확인하는 것은 다른 문서들과 같은 패턴.

## 제작·배송 (production, notification_log)

`/projects/[id]/production` 탭 — 8단계 프로세스의 마지막 단계. 다른 탭들과 달리 **탭
자체는 항상 열려 있다**(페이지 레벨 차단 없음) — 발주 이후 실제 제작(원자재준비/인쇄/제작/
검수/출고준비)은 견적·거래명세서·세금계산서 같은 서류 작업과 병행해서 진행되는 게 현실이라,
제작 단계 기록 자체를 세금계산서 발행 뒤로 미룰 이유가 없기 때문. **송장번호 등록만**
"7. 세금계산서 발행" 완료 이후로 막았다(요청하신 문구 그대로 반영).

- `production`은 프로젝트당 여러 행을 허용한다 — 배송건 하나 = 행 하나, 분할배송이면
  `is_partial_shipment=true`인 행을 추가로 만들면 된다. 제작 단계(발주완료→...→납품완료)는
  자유롭게 몇 번이든 수정 가능.
- **자동 알림 + 단계 전환**: 어떤 배송건이든 `tracking_number`가 "이번 저장에 처음"
  채워지는 순간에만(이전엔 비어있었는데 이번에 채워짐) `notification_log`에 `배송일정안내`
  행이 자동 생성되고 `advanceProjectStage(projectId, "shipping_notified", ...)`가 호출된다
  — 멱등하게 동작해서 같은 배송건을 몇 번을 더 수정 저장해도 알림이 중복 생성되지 않는다.
  이 순간에만 `assertProjectReachedStage(projectId, "tax_invoice_issued")`로 세금계산서
  발행 완료 여부를 확인한다.
- `notification_log`는 `channel`(kakao/sms/internal), `type`, `message_content`, `sent_at`,
  `status`(pending/sent/failed)를 갖는다. **실제 카카오/문자 API 연동은 아직 없다** —
  지금은 항상 `channel='internal'`, `status='pending'`, `sent_at=null`로 "생성"까지만 하고,
  나중에 팝빌/카카오 비즈니스 API 등을 붙일 때 실제 발송 후 `status`/`sent_at`을 채우면 된다.

## customers 등급/휴면 플래그

`customer_grade`/`is_dormant`는 온마음OS_기준정보_목록_고객등급체계.md의 등급 산정 로직으로
**시드 시점에 1회 계산한 스냅샷**입니다 (거래건수 기준 VIP/우수/재구매/일반, 최근거래일
12개월 경과 시 휴면). 이후 실거래가 쌓일 때 자동 재계산하는 트리거/배치는 아직 없습니다.

## 다음 단계

8단계 프로세스 추적(project_stages → production/notification_log)은 이번 회차로 전부
구현됐습니다 — 프로젝트 하나를 처음(고객 문의)부터 끝(배송일정 안내)까지 실제로 돌려서
`requires_draft` true/false 두 경우 모두 확인했습니다.

`온마음OS_마스터_DB스키마_v3.md`의 나머지 테이블(payments, supplier_payments,
ai_consultations, automation_settings 등)은 아직 구현되지 않았습니다. payments를 만들 때는
입금 확인이 프로젝트 단계와는 별도 축(수금 여부)이라 `project_stages`에 새 단계를 추가하기
보다는 `projects` 또는 `tax_invoices`에 결제 상태 플래그를 붙이는 쪽이 v3 문서 설계와
더 맞을 가능성이 높습니다 — 실제 필드 요구사항을 먼저 확인하고 시작하는 게 좋습니다.
