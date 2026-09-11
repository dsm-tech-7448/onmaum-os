import { NextResponse, type NextRequest } from "next/server";
import { ilike } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
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
      id: customers.id,
      companyName: customers.companyName,
      contactName: customers.contactName,
      customerGrade: customers.customerGrade,
    })
    .from(customers)
    .where(ilike(customers.companyName, `%${q}%`))
    .limit(20);

  return NextResponse.json({ results });
}
