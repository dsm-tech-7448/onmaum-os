import type { TaxInvoiceDraft } from "./types";

export function blankTaxInvoiceDraft(invoiceNumber: string): TaxInvoiceDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    invoiceNumber,
    statementId: null,
    customerName: "",
    purposeType: "청구",
    customerBusinessNumber: "",
    customerSubNum: "",
    customerCeoName: "",
    customerAddress: "",
    customerBusinessType: "",
    customerBusinessItem: "",
    customerEmail: "",
    scheduledDate: today,
    note: "",
    hometaxSent: false,
    items: [],
  };
}
