import { NextResponse, type NextRequest } from "next/server";
import { ilike } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { getSession } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const results = await db
    .select({
      id: suppliers.id,
      companyName: suppliers.companyName,
      phone: suppliers.phone,
      productCategory: suppliers.productCategory,
    })
    .from(suppliers)
    .where(ilike(suppliers.companyName, `%${q}%`))
    .limit(20);

  return NextResponse.json({ results });
}
