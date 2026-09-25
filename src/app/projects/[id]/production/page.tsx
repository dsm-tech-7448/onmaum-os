import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { ProductionEditor } from "./production-editor";
import { listImportablePurchaseOrders, listNotifications, listProduction } from "./actions";

export default async function ProjectProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id: projectId } = await params;

  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) notFound();

  const [batches, importablePOs, notifications] = await Promise.all([
    listProduction(projectId),
    listImportablePurchaseOrders(projectId),
    listNotifications(projectId),
  ]);

  return (
    <ProductionEditor
      projectId={projectId}
      initialBatches={batches}
      initialImportablePOs={importablePOs}
      initialNotifications={notifications}
    />
  );
}
