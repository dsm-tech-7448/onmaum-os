import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getSummaryRows } from "@/lib/dashboard/summary-sheet";
import { SummarySheetEditor } from "./summary-sheet-editor";

export default async function SummaryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await getSummaryRows({ includeHistorical: true });

  return <SummarySheetEditor initialRows={rows} />;
}
