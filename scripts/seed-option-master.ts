import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { optionMaster } from "../src/db/schema";

// 온마음_문서생성기_통합.html의 초기 masterOptions 배열 + category 분류.
// category='인쇄'는 온마음OS_마스터_DB스키마_v3.md의 requires_draft 자동판별 로직에서 쓰인다.
const OPTIONS: { name: string; category: string }[] = [
  { name: "실크인쇄", category: "인쇄" },
  { name: "전사인쇄", category: "인쇄" },
  { name: "풀컬러 전사인쇄", category: "인쇄" },
  { name: "레이저 인쇄", category: "인쇄" },
  { name: "DTF인쇄", category: "인쇄" },
  { name: "UV인쇄", category: "인쇄" },
  { name: "각인", category: "인쇄" },
  { name: "자수", category: "인쇄" },
  { name: "선물포장", category: "포장" },
  { name: "종이케이스제작", category: "포장" },
  { name: "opp 포장", category: "포장" },
  { name: "조립비", category: "가공" },
  { name: "배송비", category: "배송" },
];

async function main() {
  for (const opt of OPTIONS) {
    const [existing] = await db
      .select()
      .from(optionMaster)
      .where(eq(optionMaster.name, opt.name))
      .limit(1);

    if (existing) {
      console.log(`option already exists: ${opt.name} — skipping`);
      continue;
    }

    await db.insert(optionMaster).values(opt);
    console.log(`option seeded: ${opt.name} (${opt.category})`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("option_master seed failed:", error);
  process.exit(1);
});
