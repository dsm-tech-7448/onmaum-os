import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getDailySummaryRows } from "@/lib/dashboard/daily-summary";
import { DailySummaryEditor } from "./daily-summary-editor";

export default async function DailySummaryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await getDailySummaryRows();

  return <DailySummaryEditor initialRows={rows} />;
}
