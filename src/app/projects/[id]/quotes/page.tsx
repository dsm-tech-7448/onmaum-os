import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/db";
import { projects, customers, optionMaster, productSuggestions, companyProfile } from "@/db/schema";
import { getBrandAssets } from "@/lib/quotes/brand-assets";
import { generateQuoteNumber } from "@/lib/quotes/quote-number";
import { blankDraft } from "@/lib/quotes/blank-draft";
import { QuoteEditor } from "./quote-editor";
import { searchProjectQuotes } from "./actions";

export default async function ProjectQuotesPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id: projectId } = await params;

  const [project] = await db
    .select({ id: projects.id, customerName: customers.companyName })
    .from(projects)
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) notFound();

  const [optionRows, productRows, quoteList, quoteNumber, companyRow] = await Promise.all([
    db.select().from(optionMaster).orderBy(desc(optionMaster.usageCount)),
    db.select().from(productSuggestions).orderBy(desc(productSuggestions.usageCount)),
    searchProjectQuotes(projectId, ""),
    generateQuoteNumber(),
    db.select().from(companyProfile).limit(1),
  ]);

  const draft = blankDraft(quoteNumber);
  draft.customerName = project.customerName;
  draft.items = [
    { uid: "seed-product", lineType: "product", code: "", name: "", spec: "", unit: "개", qty: "", price: "" },
  ];

  const { logo, seal } = getBrandAssets();
  const profile = companyRow[0];

  return (
    <QuoteEditor
      projectId={projectId}
      initialDraft={draft}
      initialQuoteList={quoteList}
      optionNames={optionRows.map((o) => o.name)}
      productNames={productRows.map((p) => p.name)}
      logo={logo}
      seal={seal}
      company={{
        companyName: profile?.companyName ?? "주식회사 디에스엠텍 (DSM Tech Inc.)",
        ceoName: profile?.ceoName ?? "신충식",
        businessNumber: profile?.businessNumber ?? "357-88-00511",
        businessType: profile?.businessType ?? "제조업, 도매 및 소매업",
        businessItem: profile?.businessItem ?? "플라스틱제품",
        address: profile?.businessPlaceAddress ?? "",
        phone: profile?.phone ?? "",
        email: profile?.email ?? "",
      }}
    />
  );
}
