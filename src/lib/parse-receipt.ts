// Heuristic extraction of merchant / date / total from raw OCR text.
// It won't be perfect on every receipt — every field stays editable in the UI.

export type ParsedReceipt = {
  merchant: string | null;
  purchaseDate: string | null; // YYYY-MM-DD
  total: number | null;
  currency: string | null;
};

export type DateOrder = "DMY" | "MDY";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const MERCHANT_SKIP =
  /receipt|tax\s*invoice|invoice|welcome|thank|tel\b|phone|fax|www\.|http|@|gst\s*reg|reg\s*no|uen|vat\s*no|abn|^\d|address|^date|^time/i;

export function parseReceipt(text: string, opts: { dateOrder?: DateOrder; now?: Date } = {}): ParsedReceipt {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return {
    merchant: findMerchant(lines),
    purchaseDate: findDate(text, opts.dateOrder ?? "DMY", opts.now ?? new Date()),
    total: findTotal(lines),
    currency: findCurrency(text),
  };
}

function findMerchant(lines: string[]): string | null {
  for (const line of lines.slice(0, 6)) {
    const letters = line.replace(/[^\p{L}]/gu, "");
    if (letters.length < 3 || MERCHANT_SKIP.test(line)) continue;
    return line.replace(/\s{2,}/g, " ").slice(0, 80);
  }
  return null;
}

function toIso(y: number, m: number, d: number, now: Date): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // e.g. 31 Feb
  if (y < 2000 || dt.getTime() > now.getTime() + 2 * 86_400_000) return null; // not in the future
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function findDate(text: string, order: DateOrder, now: Date): string | null {
  // 2026-01-31, 2026/01/31, 2026.01.31
  for (const m of text.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    const iso = toIso(+m[1], +m[2], +m[3], now);
    if (iso) return iso;
  }

  // 31 Jan 2026, 31-JAN-26, 31 January, 2026
  for (const m of text.matchAll(/\b(\d{1,2})[\s\-.]*([A-Za-z]{3,9})\.?[\s\-.,]*(\d{2,4})\b/g)) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!mon) continue;
    const iso = toIso(+m[3], mon, +m[1], now);
    if (iso) return iso;
  }

  // Jan 31, 2026
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})\b/g)) {
    const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (!mon) continue;
    const iso = toIso(+m[3], mon, +m[2], now);
    if (iso) return iso;
  }

  // 31/01/2026, 01/31/26, 31.01.2026
  for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/g)) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    let day: number;
    let month: number;
    if (a > 12) [day, month] = [a, b];
    else if (b > 12) [month, day] = [a, b];
    else [day, month] = order === "DMY" ? [a, b] : [b, a];
    const iso = toIso(y, month, day, now);
    if (iso) return iso;
  }

  return null;
}

const AMOUNT_RE = /-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|-?\d+\.\d{2}|-?\d+,\d{2}(?!\d)/g;

function amountsIn(line: string): number[] {
  return [...line.matchAll(AMOUNT_RE)].map((m) => {
    let s = m[0];
    // "12,50" (decimal comma) vs "1,250.00" (thousands comma)
    s = /,\d{2}$/.test(s) && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, "");
    return parseFloat(s);
  });
}

const TOTAL_RE = /\b(grand\s*total|total\s*due|amount\s*due|balance\s*due|net\s*total|total\s*amount|total|amount\s*payable|jumlah)\b/i;
const NOT_TOTAL_RE = /sub\s*-?\s*total|total\s*(items?|qty|quantity|savings?|discount|tax|gst|vat)|before\s*tax|rounding|change|tender|cash\b/i;

function findTotal(lines: string[]): number | null {
  const candidates: { value: number; priority: number; index: number }[] = [];

  lines.forEach((line, i) => {
    const label = line.match(TOTAL_RE);
    if (!label || NOT_TOTAL_RE.test(line)) return;
    // OCR often puts the amount on the line after the label.
    let amounts = amountsIn(line);
    if (amounts.length === 0 && lines[i + 1]) amounts = amountsIn(lines[i + 1]);
    if (amounts.length === 0) return;
    const priority = /grand|due|payable|net|amount/i.test(label[1]) ? 2 : 1;
    candidates.push({ value: amounts[amounts.length - 1], priority, index: i });
  });

  if (candidates.length > 0) {
    // Highest priority label wins; among equals, the last one on the receipt.
    candidates.sort((x, y) => y.priority - x.priority || y.index - x.index);
    return candidates[0].value;
  }

  // Fallback: largest money-looking number on the receipt.
  const all = lines.flatMap(amountsIn).filter((n) => n > 0 && n < 1_000_000);
  return all.length ? Math.max(...all) : null;
}

const CURRENCY_CODES = ["SGD", "USD", "EUR", "GBP", "AUD", "CAD", "NZD", "MYR", "HKD", "JPY", "CNY", "INR", "IDR", "THB", "PHP", "KRW", "CHF"];

function findCurrency(text: string): string | null {
  const code = text.toUpperCase().match(new RegExp(`\\b(${CURRENCY_CODES.join("|")})\\b`));
  if (code) return code[1];
  if (/S\$/.test(text)) return "SGD";
  if (/A\$/.test(text)) return "AUD";
  if (/HK\$/.test(text)) return "HKD";
  if (/\bRM\s?\d/.test(text)) return "MYR";
  if (/€/.test(text)) return "EUR";
  if (/£/.test(text)) return "GBP";
  if (/¥/.test(text)) return "JPY";
  if (/₹/.test(text)) return "INR";
  return null; // a bare "$" is ambiguous
}
