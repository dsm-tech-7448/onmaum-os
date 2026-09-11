import type { TaxInvoiceDraft } from "./types";

export function blankTaxInvoiceDraft(invoiceNumber: string): TaxInvoiceDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    invoiceNumber,
    statementId: null,
    customerName: "",
    customerBusinessNumber: "",
    customerCeoName: "",
    customerAddress: "",
    customerBusinessType: "",
    customerBusinessItem: "",
    scheduledDate: today,
    note: "",
    hometaxSent: false,
    items: [],
  };
}
