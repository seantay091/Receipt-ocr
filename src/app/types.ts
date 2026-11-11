export type Receipt = {
  id: string;
  image_path: string;
  merchant: string | null;
  purchase_date: string | null;
  total: number | null;
  currency: string | null;
  group_name: string | null;
  raw_text: string | null;
  created_at: string;
};

export function formatMoney(total: number | null, currency: string | null) {
  if (total === null) return "—";
  const n = Number(total).toFixed(2);
  return currency ? `${currency} ${n}` : n;
}
