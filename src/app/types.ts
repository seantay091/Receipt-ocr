export type Receipt = {
  id: string;
  household_id: string;
  file_id: string | null;
  ocr_engine: "vision" | "claude" | "manual" | null;
  raw_text: string | null;
  receipt_no: string | null;
  purchase_date: string | null; // YYYY-MM-DD
  store_name: string | null;
  store_address: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string;
  payment_method: string | null;
  card_last4: string | null;
  notes: string | null;
  warranty_months: number | null;
  warranty_start: string | null;
  contact_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ReceiptWithFile = Receipt & { file: { storage_path: string; mime: string } | null };

export function formatMoney(total: number | null, currency: string | null) {
  if (total === null) return "—";
  const n = Number(total).toFixed(2);
  return currency ? `${currency} ${n}` : n;
}
