import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  boolean,
  integer,
  numeric,
  timestamp,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * 자사 기준정보 (단일 레코드 테이블).
 * 필드는 company_profile_시드데이터.json 구조를 그대로 따른다.
 * 온마음OS_마스터_DB스키마_v3.md: "company_profile — 이미 구축 완료(v2에서 변경 없음)"
 */
export const companyProfile = pgTable("company_profile", {
  id: uuid("id").primaryKey().defaultRandom(),

  brandName: varchar("brand_name", { length: 100 }).notNull(),
  companyName: varchar("company_name", { length: 200 }).notNull(),
  ceoName: varchar("ceo_name", { length: 50 }).notNull(),
  businessNumber: varchar("business_number", { length: 20 }).notNull().unique(),
  corporateRegistrationNumber: varchar("corporate_registration_number", {
    length: 30,
  }),
  openingDate: date("opening_date"),
  businessPlaceAddress: text("business_place_address"),
  headquartersAddress: text("headquarters_address"),
  businessType: varchar("business_type", { length: 100 }),
  businessItem: varchar("business_item", { length: 100 }),
  phone: varchar("phone", { length: 30 }),
  fax: varchar("fax", { length: 30 }),
  email: varchar("email", { length: 200 }),
  websiteMain: varchar("website_main", { length: 200 }),
  websiteSecondary: varchar("website_secondary", { length: 200 }),
  bankName: varchar("bank_name", { length: 50 }),
  accountNumber: varchar("account_number", { length: 50 }),
  accountType: varchar("account_type", { length: 50 }),
  accountHolder: varchar("account_holder", { length: 100 }),
  swiftCode: varchar("swift_code", { length: 20 }),
  logoImage: varchar("logo_image", { length: 255 }),
  sealImage: varchar("seal_image", { length: 255 }),
  note: text("note"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CompanyProfile = typeof companyProfile.$inferSelect;
export type NewCompanyProfile = typeof companyProfile.$inferInsert;

/**
 * 로그인 사용자.
 * v3 문서에는 상세 필드가 없어(users는 "그 외 테이블"로만 언급) 로그인에 필요한
 * 최소 구성으로 정의. project_stage_log.changed_by, projects.assigned_to 등이
 * 이 테이블을 참조할 예정이므로 uuid PK를 유지한다.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 200 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("staff"), // admin | staff
  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * 고객 기준정보. 필드는 온마음OS_기준정보_목록_고객등급체계.md의 customers 정의를 따르고,
 * 온마음OS_고객공급업체_시드데이터.xlsx("고객 시드데이터" 시트)로 채워진다.
 * customerGrade/isDormant는 같은 문서의 등급 산정 로직으로 시드 시점에 1회 계산한 스냅샷이며,
 * 실거래 발생 시 재계산하는 트리거/배치는 별도 구현 필요.
 */
export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),

  companyName: varchar("company_name", { length: 200 }).notNull(),
  businessNumber: varchar("business_number", { length: 20 }),
  contactName: varchar("contact_name", { length: 100 }),
  mobilePhone: varchar("mobile_phone", { length: 30 }),
  officePhone: varchar("office_phone", { length: 30 }),
  email: varchar("email", { length: 200 }),
  address: text("address"),
  acquisitionChannel: varchar("acquisition_channel", { length: 100 }),

  transactionCount: integer("transaction_count").notNull().default(0),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }),
  firstTransactionDate: date("first_transaction_date"),
  lastTransactionDate: date("last_transaction_date"),
  peakSeasonMonth: integer("peak_season_month"), // 1~12

  customerGrade: varchar("customer_grade", { length: 20 }), // VIP | 우수 | 재구매 | 일반
  isDormant: boolean("is_dormant").notNull().default(false),
  assignedSalesRep: uuid("assigned_sales_rep").references(() => users.id),
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

/**
 * 공급업체 기준정보. 필드는 온마음OS_기준정보_목록_고객등급체계.md의 suppliers 정의를 따르고,
 * 온마음OS_고객공급업체_시드데이터.xlsx("공급업체 시드데이터" 시트)로 채워진다.
 */
export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),

  companyName: varchar("company_name", { length: 200 }).notNull(),
  contactName: varchar("contact_name", { length: 100 }),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 200 }),
  productCategory: varchar("product_category", { length: 200 }),

  transactionCount: integer("transaction_count").notNull().default(0),
  totalPurchaseAmount: numeric("total_purchase_amount", { precision: 14, scale: 2 }),
  firstTransactionDate: date("first_transaction_date"),
  lastTransactionDate: date("last_transaction_date"),

  accountInfo: text("account_info"),
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;

/**
 * 진행 단계 정의표 (고정 8단계, 데이터로 관리).
 * 온마음OS_마스터_DB스키마_v3.md "신규 — project_stages"
 */
export const projectStages = pgTable("project_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  stageCode: varchar("stage_code", { length: 30 }).notNull().unique(),
  stageName: varchar("stage_name", { length: 50 }).notNull(),
  sortOrder: integer("sort_order").notNull(),
  statusColor: varchar("status_color", { length: 20 }),
});

export type ProjectStage = typeof projectStages.$inferSelect;
export type NewProjectStage = typeof projectStages.$inferInsert;

/**
 * 프로젝트 허브. requires_draft=false면 시안작성(3)/시안확정(4) 단계를 건너뛴다.
 * 온마음OS_마스터_DB스키마_v3.md "변경 — projects"
 */
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectNumber: varchar("project_number", { length: 30 }).notNull().unique(), // e.g. PJ-2026-0078
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  currentStageId: uuid("current_stage_id").references(() => projectStages.id),
  requiresDraft: boolean("requires_draft").notNull().default(true),
  isUrgent: boolean("is_urgent").notNull().default(false),
  assignedTo: uuid("assigned_to").references(() => users.id),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

/**
 * 단계 이력 — 프로젝트가 어느 단계를 언제 통과했는지 기록.
 * "3일 이상 같은 단계에 머무름 = 지연 의심" 대시보드 쿼리의 근거 데이터.
 * 온마음OS_마스터_DB스키마_v3.md "신규 — project_stage_log"
 */
export const projectStageLog = pgTable("project_stage_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  stageId: uuid("stage_id")
    .notNull()
    .references(() => projectStages.id),
  reachedAt: timestamp("reached_at", { withTimezone: true }).notNull().defaultNow(),
  changedBy: uuid("changed_by").references(() => users.id),
});

export type ProjectStageLog = typeof projectStageLog.$inferSelect;
export type NewProjectStageLog = typeof projectStageLog.$inferInsert;

/**
 * 옵션 마스터 — 누적형 자동완성 (엑셀 유효성 검사처럼 동작).
 * 온마음_문서생성기_통합.html의 masterOptions 배열을 대체.
 * category='인쇄'는 온마음OS_마스터_DB스키마_v3.md의 requires_draft 자동판별 로직에서 쓰인다.
 */
export const optionMaster = pgTable("option_master", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  category: varchar("category", { length: 50 }), // 인쇄 | 포장 | 가공 | 배송 ...
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OptionMaster = typeof optionMaster.$inferSelect;
export type NewOptionMaster = typeof optionMaster.$inferInsert;

/**
 * 상품명 누적형 자동완성. option_master와 동일한 개념이지만 품목(상품) 이름 전용 목록.
 */
export const productSuggestions = pgTable("product_suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull().unique(),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProductSuggestion = typeof productSuggestions.$inferSelect;
export type NewProductSuggestion = typeof productSuggestions.$inferInsert;

/**
 * 견적서. 리비전마다 별도 행 — "저장"은 항상 새 리비전을 INSERT하며 기존 행은 절대 수정하지
 * 않는다 (온마음_문서생성기_통합.html의 savedQuotes[no].revisions 배열과 동일한 모델).
 * (project_id, quote_number, revision) 조합이 하나의 리비전을 유일하게 식별한다.
 *
 * mode='compare'(수량구간 비교견적)일 때만 compareProduct* 필드와 quote_tiers를 사용하고,
 * 'single'/'multiple'은 화면 프리셋 차이일 뿐 저장 구조는 동일하게 quote_items 평면 목록을 쓴다.
 */
export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    quoteNumber: varchar("quote_number", { length: 30 }).notNull(), // QT-20260812-0001
    revision: integer("revision").notNull().default(1),
    mode: varchar("mode", { length: 10 }).notNull().default("single"), // single | multiple | compare

    customerName: varchar("customer_name", { length: 200 }).notNull(),
    // 고객사 담당자는 자주 바뀌고 한 회사에 여러 명일 수 있어 고객사 마스터에서 끌어오지 않고
    // 견적 작성 시점마다 직접 입력한다 — 이후 시안/발주서/거래명세서도 이 값을 그대로 이어받는다.
    contactName: varchar("contact_name", { length: 100 }),
    contactPhone: varchar("contact_phone", { length: 30 }),
    quoteDate: date("quote_date").notNull(),
    validity: varchar("validity", { length: 50 }),
    confirmText: text("confirm_text"),
    mainImageDataUrl: text("main_image_data_url"),

    // compare 모드 전용 (상품 정보를 한 번만 입력하고 구간별로는 수량/단가만 다르게)
    compareProductCode: varchar("compare_product_code", { length: 50 }),
    compareProductName: varchar("compare_product_name", { length: 200 }),
    compareProductSpec: varchar("compare_product_spec", { length: 200 }),

    // 견적 총액을 특정 금액(예: 육백만원 정)에 맞추기 위한 절삭/조정 — 품목별 계산과 별개로
    // 최종 합계(공급가+세액)에 그대로 더해진다. 음수도 가능하다.
    adjustmentLabel: varchar("adjustment_label", { length: 50 }),
    adjustmentAmount: numeric("adjustment_amount", { precision: 12, scale: 2 }),

    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.projectId, table.quoteNumber, table.revision)]
);

export type Quote = typeof quotes.$inferSelect;
export type NewQuote = typeof quotes.$inferInsert;

/**
 * 비교견적(mode='compare') 모드의 수량 구간. 구간마다 quote_items를 독립적으로 가진다
 * (수량이 늘수록 인쇄비는 내려가고 배송비는 올라가는 식으로 구간마다 옵션 구성이 달라질 수 있음).
 */
export const quoteTiers = pgTable("quote_tiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
});

export type QuoteTier = typeof quoteTiers.$inferSelect;
export type NewQuoteTier = typeof quoteTiers.$inferInsert;

/**
 * 견적 라인아이템 — 고정 필드(인쇄비/배송비)가 아니라 가변 행 구조.
 * line_type으로 "품목 줄"/"옵션 줄"을 구분해 저장 시 product_suggestions/option_master 중
 * 어디에 누적할지 판단한다. tier_id가 있으면 compare 모드의 특정 구간에 속한 행이다.
 */
export const quoteItems = pgTable("quote_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  tierId: uuid("tier_id").references(() => quoteTiers.id, { onDelete: "cascade" }),

  lineType: varchar("line_type", { length: 10 }).notNull().default("option"), // product | option
  code: varchar("code", { length: 50 }),
  name: varchar("name", { length: 200 }).notNull(),
  spec: varchar("spec", { length: 200 }),
  unit: varchar("unit", { length: 20 }).default("개"),
  qty: numeric("qty", { precision: 12, scale: 2 }),
  price: numeric("price", { precision: 12, scale: 2 }),
  // 단가로 나누어떨어지지 않는 공급가(예: 4,445,345원)를 그대로 수기 입력할 때 쓴다 — 값이
  // 있으면 수량×단가 대신 이 값을 그 줄의 공급가로 쓴다. 거래명세서/세금계산서로 그대로 이어진다.
  supplyOverride: numeric("supply_override", { precision: 12, scale: 2 }),
  sortOrder: integer("sort_order").notNull(),
  imageDataUrl: text("image_data_url"), // 품목(product) 줄 전용 — 복수 품목 견적서에서 품목별 이미지
});

export type QuoteItem = typeof quoteItems.$inferSelect;
export type NewQuoteItem = typeof quoteItems.$inferInsert;

/**
 * 인쇄 시안. quotes와 같은 리비전 모델 — "저장"은 항상 새 행을 INSERT하고 과거 리비전은
 * 수정하지 않는다. 리비전 번호는 프로젝트 안에서만 유일(quotes처럼 별도 번호 텍스트는 없음).
 * isConfirmed=true인 리비전이 "4. 고객 시안 확정" 단계로의 전환을 트리거한다.
 * requires_draft=false인 프로젝트는 애초에 이 테이블에 레코드가 없어도 정상
 * (온마음OS_마스터_DB스키마_v3.md 참고).
 */
export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    revision: integer("revision").notNull().default(1),
    note: text("note"),
    // 이 시안이 어느 견적서를 바탕으로 작성됐는지 — "불러오기"로 명시적으로 선택해야
    // 화면에 견적 내용이 보이고, 저장 시 이 리비전에 그대로 연결된다(자동 추정 금지).
    quoteId: uuid("quote_id").references(() => quotes.id),

    isConfirmed: boolean("is_confirmed").notNull().default(false),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: uuid("confirmed_by").references(() => users.id),

    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.projectId, table.revision)]
);

export type Draft = typeof drafts.$inferSelect;
export type NewDraft = typeof drafts.$inferInsert;

/**
 * 시안 리비전에 딸린 이미지들 (정면/측면/컬러 옵션 등 여러 장 가능).
 */
export const draftImages = pgTable("draft_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id")
    .notNull()
    .references(() => drafts.id, { onDelete: "cascade" }),
  imageDataUrl: text("image_data_url").notNull(),
  caption: varchar("caption", { length: 100 }),
  sortOrder: integer("sort_order").notNull(),
});

export type DraftImage = typeof draftImages.$inferSelect;
export type NewDraftImage = typeof draftImages.$inferInsert;

/**
 * 발주서. quotes와 같은 리비전 모델 — "저장"은 항상 새 행을 INSERT하고 과거 리비전은
 * 수정하지 않는다. 공급자는 suppliers에서 검색해 선택하거나(supplier_id) 새 업체명을
 * 자유 입력할 수 있어(supplier_name 스냅샷) supplier_id는 nullable.
 * 저장 시 "5. 공급처 발주" 단계로 전환 — 견적을 거치지 않고 발주부터 만드는 경우는 없으므로
 * requires_draft=true는 인쇄 시안 작성(3) 이후, false는 견적 발송(2) 이후에만 저장 가능
 * (고객의 시안 확정은 이메일/문자로 별도 전달되고 앱에 입력하지 않는다).
 * (온마음_문서생성기_통합.html의 발주서 필드 그대로: 발송요청일/지불조건/수신자/배송주소/수령자).
 */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    poNumber: varchar("po_number", { length: 30 }).notNull(), // PO-20260812-0001
    revision: integer("revision").notNull().default(1),

    // 이 발주가 어느 견적서(=고객 매출)를 근거로 나갔는지 — "불러오기"로 명시적으로
    // 선택해야 하고(자동 추정 금지, drafts.quote_id와 같은 패턴), 매입(발주 금액)을
    // 매출(견적 금액)과 짝지어 이익을 계산하는 데도 쓴다.
    quoteId: uuid("quote_id").references(() => quotes.id),
    // 그 견적서 중에서도 구체적으로 어느 품목(줄)에 대한 발주인지 — 상품마다 공급업체가
    // 보통 다르므로(가끔 한 업체가 2~3개 품목을 함께 공급하기도 하지만) 발주는 원칙적으로
    // 품목 하나 단위로 작성한다. 참고/기본값 채우기용이며 하드 제약은 아니다.
    quoteItemId: uuid("quote_item_id").references(() => quoteItems.id),

    supplierId: uuid("supplier_id").references(() => suppliers.id),
    supplierName: varchar("supplier_name", { length: 200 }).notNull(),
    supplierPhone: varchar("supplier_phone", { length: 30 }),
    receiver: varchar("receiver", { length: 100 }),

    poDate: date("po_date").notNull(),
    reqDate: date("req_date"), // 발송요청일
    payTerm: varchar("pay_term", { length: 50 }), // 지불조건
    printNote: varchar("print_note", { length: 100 }), // 인쇄 확인 상태 (예: 없음/첨부 확인/최종본)

    shipAddr: text("ship_addr"),
    shipReceiver: varchar("ship_receiver", { length: 100 }),

    note: text("note"), // 특기사항 — 이 발주 건에만 해당하는 추가 메모, 건마다 다름(기본 비어있음)
    requestNote: text("request_note"), // 요청사항 — 발송자 표기/송장번호 통보 등 표준 요청 문구

    // 공급업체에 실제로 지급한 금액/일자 — 대시보드 "공급업체 입금" 체크리스트용.
    // 리비전 단위 문서지만 입금은 보통 확정 이후 일어나는 별도 이벤트라 새 리비전 없이
    // 해당 리비전 행에 직접 기록한다(리비전이 바뀌면 재입력).
    paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }),
    paidDate: date("paid_date"),

    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.projectId, table.poNumber, table.revision)]
);

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;

/**
 * 발주 라인아이템 — quote_items와 동일한 가변 구조(품목/옵션 줄 구분, 순서).
 */
export const poItems = pgTable("po_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  poId: uuid("po_id")
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: "cascade" }),

  lineType: varchar("line_type", { length: 10 }).notNull().default("option"), // product | option
  code: varchar("code", { length: 50 }),
  name: varchar("name", { length: 200 }).notNull(),
  spec: varchar("spec", { length: 200 }),
  unit: varchar("unit", { length: 20 }).default("개"),
  qty: numeric("qty", { precision: 12, scale: 2 }),
  price: numeric("price", { precision: 12, scale: 2 }),
  sortOrder: integer("sort_order").notNull(),
});

export type PoItem = typeof poItems.$inferSelect;
export type NewPoItem = typeof poItems.$inferInsert;

/**
 * 거래명세서. quotes/purchase_orders와 달리 리비전 개념이 없다 — 온마음_문서생성기_통합.html에
 * 거래명세서용 "저장"/리비전 이력 UI 자체가 없고(견적서·발주서만 있음), 한 번 발송하면
 * 끝나는 문서라는 실제 업무 방식과 맞다. 그래서 하나의 statement_number = 하나의 행이고
 * 수정/재저장 없이, 필요하면(예: 분할 출고) 새 번호로 별도 행을 또 만든다.
 * purchase_order_id는 어느 발주서 품목에서 가져왔는지 추적용(nullable — 수동 입력도 가능).
 * tax_invoice_id 연결(v3 문서: "거래명세서 발송이 세금계산서 발행보다 먼저")은
 * tax_invoices 테이블이 아직 없어 이번엔 컬럼을 추가하지 않았다 — 나중에 nullable FK로 추가.
 */
export const transactionStatements = pgTable("transaction_statements", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  statementNumber: varchar("statement_number", { length: 30 }).notNull().unique(), // TX-20260812-0001
  purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id),
  // 이 거래명세서가 어느 견적서(=고객 매출)를 근거로 나갔는지 — drafts.quote_id /
  // purchase_orders.quote_id와 같은 패턴으로 "불러오기"를 통해 명시적으로 선택한다.
  quoteId: uuid("quote_id").references(() => quotes.id),
  // 세금계산서는 거래명세서 발송보다 나중에 붙는다 — 처음엔 항상 null.
  // 온마음OS_마스터_DB스키마_v3.md: "거래명세서 발송이 세금계산서 발행보다 먼저"
  taxInvoiceId: uuid("tax_invoice_id").references((): AnyPgColumn => taxInvoices.id),

  customerName: varchar("customer_name", { length: 200 }).notNull(),
  // 등록번호/담당자/주소는 견적서에 없는 값이라 거래명세서 작성 시 필요하면 직접 입력한다
  // (사업자등록증 사본을 나중에 받는 경우가 많아 처음엔 비워둘 수 있다).
  customerBusinessNumber: varchar("customer_business_number", { length: 50 }),
  customerContactName: varchar("customer_contact_name", { length: 100 }),
  customerAddress: text("customer_address"),
  // 발주와 동시에 입금되는 경우도 있고 그렇지 않은 경우도 있어 선택 입력으로 둔다.
  // 결제액(현금/카드) 입력이 새로 생겼지만 미수금은 계속 수기 입력 — 자동계산으로
  // 바꾸지 않는다(둘은 별개 필드, 사용자 확인 2026-09-03).
  outstandingAmount: varchar("outstanding_amount", { length: 20 }),
  // 실제 고객 결제 입력(참고용) — 대시보드 "고객 결제 입력" 체크리스트용.
  paidCash: numeric("paid_cash", { precision: 12, scale: 2 }),
  paidCard: numeric("paid_card", { precision: 12, scale: 2 }),
  paidDate: date("paid_date"),
  // 현금영수증 발행일 — 세금계산서(tax_invoices)와 별개의 영수증 종류. 세금계산서든
  // 현금영수증이든 "둘 중 하나만" 발행되면 7단계(영수증 발행)로 진입한다.
  cashReceiptIssuedAt: date("cash_receipt_issued_at"),
  // 견적서와 마찬가지로 거래명세서 총액을 맞추기 위한 절삭/조정 — 최종 합계에 그대로
  // 더해진다(음수 가능). 세금계산서는 법정 서식이라 이 개념이 없다.
  adjustmentLabel: varchar("adjustment_label", { length: 50 }),
  adjustmentAmount: numeric("adjustment_amount", { precision: 12, scale: 2 }),
  statementDate: date("statement_date").notNull(),
  note: text("note"),

  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TransactionStatement = typeof transactionStatements.$inferSelect;
export type NewTransactionStatement = typeof transactionStatements.$inferInsert;

/**
 * 거래명세서 라인아이템 — po_items/quote_items와 동일한 구조(발주서 품목을 그대로 복사).
 */
export const statementItems = pgTable("statement_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  statementId: uuid("statement_id")
    .notNull()
    .references(() => transactionStatements.id, { onDelete: "cascade" }),
  // 원본 견적 품목 — purchase_orders.quote_item_id와 이 값을 매칭하면 발주(매입) ↔
  // 거래명세서 품목(매출)을 이름 대조 없이 정확히 조인할 수 있다(대시보드 원장용).
  quoteItemId: uuid("quote_item_id").references(() => quoteItems.id),

  lineType: varchar("line_type", { length: 10 }).notNull().default("option"), // product | option
  code: varchar("code", { length: 50 }),
  name: varchar("name", { length: 200 }).notNull(),
  spec: varchar("spec", { length: 200 }),
  unit: varchar("unit", { length: 20 }).default("개"),
  qty: numeric("qty", { precision: 12, scale: 2 }),
  price: numeric("price", { precision: 12, scale: 2 }),
  supplyOverride: numeric("supply_override", { precision: 12, scale: 2 }), // 견적서와 동일한 수기 공급가
  sortOrder: integer("sort_order").notNull(),
});

export type StatementItem = typeof statementItems.$inferSelect;
export type NewStatementItem = typeof statementItems.$inferInsert;

/**
 * 세금계산서. 거래명세서(statement_id)에서 고객·품목 정보를 가져와 만들고,
 * "발행 요청 → 확인 → 발행"의 3단계 흐름을 status로 추적한다(자동발행 아님).
 * 생성 시 원본 거래명세서의 tax_invoice_id를 이 행으로 채워 연결한다
 * (온마음OS_마스터_DB스키마_v3.md: "거래명세서 발송이 세금계산서 발행보다 먼저").
 * hometax_sent는 팝빌/바로빌 등 외부 발행 API 연동 자리 — 지금은 값만 남겨두고 미연동.
 */
export const taxInvoices = pgTable("tax_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  statementId: uuid("statement_id")
    .notNull()
    .references(() => transactionStatements.id),
  invoiceNumber: varchar("invoice_number", { length: 30 }).notNull().unique(), // TI-20260812-0001

  customerName: varchar("customer_name", { length: 200 }).notNull(),
  // 공급받는자 사업자등록증 정보 — 거래명세서 발송 뒤에야 고객에게서 받는 경우가 많아
  // 세금계산서 발행 요청 단계에서 별도로 입력한다. 등록번호/주소는 이미 있는 값이면
  // requestTaxInvoice가 연결된 거래명세서(customer_business_number/customer_address)에도
  // 함께 반영한다(재발송은 하지 않음, 데이터만 최신화).
  customerBusinessNumber: varchar("customer_business_number", { length: 50 }),
  customerCeoName: varchar("customer_ceo_name", { length: 100 }),
  customerAddress: text("customer_address"),
  customerBusinessType: varchar("customer_business_type", { length: 100 }), // 업태
  customerBusinessItem: varchar("customer_business_item", { length: 100 }), // 종목
  status: varchar("status", { length: 20 }).notNull().default("requested"), // requested | confirmed | issued
  scheduledDate: date("scheduled_date"), // 발행예정일

  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  issuedAt: timestamp("issued_at", { withTimezone: true }),

  // 팝빌 등 ASP 연동으로 실제 발행/알림톡 발송하는 것은 이후 단계 — 지금은 수동 체크만 기록한다.
  hometaxSent: boolean("hometax_sent").notNull().default(false), // 팝빌/바로빌 등 외부 API 연동 자리

  note: text("note"),

  requestedBy: uuid("requested_by").references(() => users.id),
  confirmedBy: uuid("confirmed_by").references(() => users.id),
  issuedBy: uuid("issued_by").references(() => users.id),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TaxInvoice = typeof taxInvoices.$inferSelect;
export type NewTaxInvoice = typeof taxInvoices.$inferInsert;

/**
 * 세금계산서 라인아이템 — statement_items/po_items/quote_items와 동일한 구조.
 */
export const taxInvoiceItems = pgTable("tax_invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  taxInvoiceId: uuid("tax_invoice_id")
    .notNull()
    .references(() => taxInvoices.id, { onDelete: "cascade" }),

  lineType: varchar("line_type", { length: 10 }).notNull().default("option"), // product | option
  code: varchar("code", { length: 50 }),
  name: varchar("name", { length: 200 }).notNull(),
  spec: varchar("spec", { length: 200 }),
  unit: varchar("unit", { length: 20 }).default("개"),
  qty: numeric("qty", { precision: 12, scale: 2 }),
  price: numeric("price", { precision: 12, scale: 2 }),
  supplyOverride: numeric("supply_override", { precision: 12, scale: 2 }), // 견적서와 동일한 수기 공급가
  sortOrder: integer("sort_order").notNull(),
});

export type TaxInvoiceItem = typeof taxInvoiceItems.$inferSelect;
export type NewTaxInvoiceItem = typeof taxInvoiceItems.$inferInsert;

/**
 * 제작~배송 진행 상황. 분할배송을 지원하려고 프로젝트당 여러 행을 허용한다
 * (배송건 하나 = 행 하나). tracking_number가 "새로" 채워지는 순간(이전엔 비어있었는데
 * 이번 저장에 처음 채워짐) notification_log에 배송일정안내 알림이 자동 생성되고
 * 프로젝트가 "8. 배송일정 안내"로 전환된다 — src/app/projects/[id]/production/actions.ts
 * 참고. 온마음OS_마스터_DB스키마_v3.md: "production.tracking_number 입력됨 →
 * notification_log INSERT → project_stage_log에 shipping_notified 기록".
 */
/**
 * 제작·배송 — 실제 업무는 "발주서에 적힌 발송요청일에 공급업체가 보냈는지 확인하고,
 * 업체가 알려준 송장번호를 입력하는" 것뿐이라 내부 제작 단계(원자재준비 등)는 추적하지
 * 않는다. 품목마다 발주서가 따로 나가므로(po_items 패턴), 배송건도 발주서 1건당 1행으로
 * 자연히 분할배송을 표현한다.
 */
export const production = pgTable("production", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  // 이 배송이 어느 발주서에 대한 건인지 — "불러오기"로 명시적으로 선택한다(다른 문서와
  // 같은 패턴). 발송요청일은 이 발주서에서 그대로 참고한다.
  poId: uuid("po_id").references(() => purchaseOrders.id),

  carrier: varchar("carrier", { length: 50 }), // 택배사
  trackingNumber: varchar("tracking_number", { length: 50 }), // 송장번호
  actualShipDate: date("actual_ship_date"), // 발송 확인일

  note: text("note"),

  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Production = typeof production.$inferSelect;
export type NewProduction = typeof production.$inferInsert;

/**
 * 알림 발송 이력(카카오알림톡/문자/내부알림). 지금은 실제 외부 API 연동 없이 "생성"까지만 —
 * status는 항상 pending으로 쌓이고, 실제 발송 연동은 나중 단계에서 sent_at/status를 채운다.
 */
export const notificationLog = pgTable("notification_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),

  channel: varchar("channel", { length: 20 }).notNull().default("internal"), // kakao | sms | internal
  type: varchar("type", { length: 50 }).notNull(), // 예: 배송일정안내
  messageContent: text("message_content").notNull(),

  sentAt: timestamp("sent_at", { withTimezone: true }),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | sent | failed

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationLog = typeof notificationLog.$inferSelect;
export type NewNotificationLog = typeof notificationLog.$inferInsert;

/**
 * 과거 Daily Summary 엑셀(2017-11~2025-12, 온마음/온마음기프트/온마음마켓 계열)에서 이관한
 * 이력 데이터. 실제 견적서/발주서/거래명세서 문서를 재구성하지 않고 매입/매출/이익 숫자만
 * 담는다 — 대시보드 상품별 집계에 과거 실적을 반영하기 위한 읽기 전용 참고 테이블.
 * 문서 참조가 없으므로 FK 없음, 미수금 개념도 없음(전부 정산 종료된 과거 건).
 */
export const historicalOrders = pgTable("historical_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  brand: varchar("brand", { length: 50 }),
  orderDate: date("order_date"),
  customerName: varchar("customer_name", { length: 200 }),
  contactName: varchar("contact_name", { length: 100 }),
  contactPhone: varchar("contact_phone", { length: 50 }),
  productName: varchar("product_name", { length: 300 }),
  qty: numeric("qty", { precision: 12, scale: 2 }),
  supplierName: varchar("supplier_name", { length: 200 }),
  supplierPhone: varchar("supplier_phone", { length: 50 }),
  shipDate: date("ship_date"),
  note: text("note"),
  revenue: numeric("revenue", { precision: 14, scale: 2 }), // 결제(현금+카드) 합계
  cost: numeric("cost", { precision: 14, scale: 2 }), // 출금(매입)
  profit: numeric("profit", { precision: 14, scale: 2 }), // revenue - cost
  sourceFile: varchar("source_file", { length: 100 }), // 이관 출처 스냅샷 파일명 (디버깅용)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HistoricalOrder = typeof historicalOrders.$inferSelect;
export type NewHistoricalOrder = typeof historicalOrders.$inferInsert;

/**
 * 고객/공급업체가 프로젝트 진행 중 요청한 사항의 기록. 특정 문서(견적/발주/명세서)에
 * 종속시키지 않고 프로젝트 단위로 기록한다 — 요청은 문서 작성 시점과 무관하게 언제든
 * 들어올 수 있어서다. 대시보드 "미해결 요청사항" 목록의 데이터 소스.
 */
export const projectRequests = pgTable("project_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  source: varchar("source", { length: 20 }).notNull(), // customer | supplier
  content: text("content").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedNote: text("resolved_note"),
  createdBy: uuid("created_by").references(() => users.id),
});

export type ProjectRequest = typeof projectRequests.$inferSelect;
export type NewProjectRequest = typeof projectRequests.$inferInsert;

/**
 * Summary 장표 전용 정정값. 견적서/발주서는 실제로 고객·공급업체에 보낸 문서라 원본이
 * 그대로 남아야 한다(2026-09-03) — 그래서 공급업체 사정 등으로 날짜/연락처 같은 값이
 * 바뀌어도 quotes/quote_items/purchase_orders/production 원본 행을 직접 고쳐쓰지 않고,
 * Summary가 화면에 보여줄 "현재 값"만 이 테이블에 별도로 기록한다. row_key는
 * summary-sheet.ts의 SummaryRow.rowKey(대개 quote_items.id, orphan 행은 po-/stmt- 접두사)와
 * 같다. 각 컬럼이 null이면 원본 값을 그대로 보여주고, 값이 있으면 그 값으로 덮어쓴다.
 */
export const summaryOverrides = pgTable("summary_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  rowKey: varchar("row_key", { length: 100 }).notNull().unique(),
  orderDate: date("order_date"),
  contactName: varchar("contact_name", { length: 100 }),
  customerName: varchar("customer_name", { length: 200 }),
  contactPhone: varchar("contact_phone", { length: 30 }),
  productCode: varchar("product_code", { length: 50 }),
  productName: varchar("product_name", { length: 200 }),
  qty: numeric("qty", { precision: 12, scale: 2 }),
  reqDate: date("req_date"),
  supplierName: varchar("supplier_name", { length: 200 }),
  supplierPhone: varchar("supplier_phone", { length: 30 }),
  shipDate: date("ship_date"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

export type SummaryOverride = typeof summaryOverrides.$inferSelect;
export type NewSummaryOverride = typeof summaryOverrides.$inferInsert;
