// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReceipt } from "./parse-receipt.ts";

const now = new Date("2026-11-11T00:00:00Z");

test("typical supermarket receipt", () => {
  const r = parseReceipt(
    `FAIRMART SUPERSTORE
123 Orchard Road
Tel: 6123 4567
GST Reg No: 200012345X
Date: 03/11/2026 14:22
Milk 1L            3.45
Bread              2.80
SUBTOTAL           6.25
GST 9%             0.56
TOTAL              6.81
CASH              10.00
CHANGE             3.19`,
    { now },
  );
  assert.deepEqual(r, { merchant: "FAIRMART SUPERSTORE", purchaseDate: "2026-11-03", total: 6.81, currency: null });
});

test("amount on the line after the label, month names, currency code", () => {
  const r = parseReceipt(
    `TAX INVOICE
Blue Bottle Cafe
12 Oct 2026  09:15
Latte                 USD 5.50
Croissant             USD 4.25
Grand Total
USD 9.75`,
    { now },
  );
  assert.equal(r.merchant, "Blue Bottle Cafe");
  assert.equal(r.purchaseDate, "2026-10-12");
  assert.equal(r.total, 9.75);
  assert.equal(r.currency, "USD");
});

test("ISO dates, thousands separators, symbols", () => {
  const r = parseReceipt(`Electronics Hub\n2026-02-14\nLaptop  S$1,299.00\nTotal Due S$1,299.00`, { now });
  assert.equal(r.purchaseDate, "2026-02-14");
  assert.equal(r.total, 1299);
  assert.equal(r.currency, "SGD");
});

test("ambiguous numeric dates follow the configured order", () => {
  assert.equal(parseReceipt("Shop\n04/05/2026\nTotal 1.00", { now, dateOrder: "DMY" }).purchaseDate, "2026-05-04");
  assert.equal(parseReceipt("Shop\n04/05/2026\nTotal 1.00", { now, dateOrder: "MDY" }).purchaseDate, "2026-04-05");
  assert.equal(parseReceipt("Shop\n04/25/2026\nTotal 1.00", { now, dateOrder: "DMY" }).purchaseDate, "2026-04-25");
});

test("returns nulls for empty text", () => {
  assert.deepEqual(parseReceipt("", { now }), { merchant: null, purchaseDate: null, total: null, currency: null });
});
