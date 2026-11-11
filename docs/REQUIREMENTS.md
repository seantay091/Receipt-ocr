# Receipt OCR & Warranty Tracker — Requirements & Low-Level Design

Status: **v2 — cloud** (2026-11-11). v1 targeted a local FastAPI + SQLite app. That code was removed when the cloud app from `main` (Next.js + Supabase + Google Vision) became the base. All functional requirements from v1 still apply unless noted below.

## 1. Summary

A cloud web app for a household to upload receipt photos and PDFs. It extracts the receipt data with OCR, lets the user review and correct it, and tracks warranties and repair contacts for each purchased item. Items are grouped with free-form tags such as "Kitchen" or "Living Room".

## 2. Decisions

| Topic | Decision |
|---|---|
| Hosting | **Cloud, free tiers:** Next.js on **Vercel**; **Supabase** for Postgres, Auth and Storage |
| Users | **Shared household.** Each person signs in with a Supabase magic link and belongs to a household. All household members see and edit the same receipts |
| Input | **Desktop upload** of images (JPG/PNG/WebP) and **PDF / e-receipts**. One PDF = one receipt |
| OCR | **Google Vision by default.** The user can switch to **Claude** with a toggle on upload and a "Re-process with Claude" button on the review screen. No automatic fallback |
| Keys | `GOOGLE_VISION_API_KEY` and `ANTHROPIC_API_KEY` are server-side env vars only. If the Claude key is missing, the Claude option is hidden |
| Review | **Always** show a review screen (original next to editable fields) before a receipt is saved |
| Warranty | **Months only.** A receipt-level default that each item can override or opt out of (`no_warranty`) |
| Repair contacts | Name/company, phone, email, address, website. **Reusable** contact records per household |
| Grouping | **Multiple tags per item** (many-to-many). This replaces the single `group_name` on receipts |
| Receipt fields | Receipt no., date, store name & address, items, subtotal, tax (GST), total, currency, payment method (+ card last 4) |
| Line items | Qty, unit price, line total, model no., serial no., **attachments** (warranty card, manual, photo) |
| Extras in v1 | Warranty expiry **in-app dashboard**, **search & filter**, **CSV export + full export** |
| Duplicates | Warn on duplicates: the same file (sha256) or the same store + receipt no. + date |
| Currency | Default **SGD**; tax label "GST"; detected currency is used if present |
| Originals | Kept for as long as the receipt exists (deleting a receipt deletes its files) |
| Out of scope (v1) | Phone camera capture/PWA, spending reports, email alerts, calendar export, discount lines, multi-currency totals |

## 3. Architecture

```
Browser (Next.js client components)
  ├── upload: compute sha256, shrink images (max 2000 px), upload original → Supabase Storage (private bucket)
  └── server actions / route handlers (Vercel, Node runtime)
        ├── Supabase (Postgres + RLS, Auth via cookies, Storage)
        └── OCR
              ├── VisionEngine: images → images:annotate (DOCUMENT_TEXT_DETECTION)
              │                 PDFs   → files:annotate (inline content, up to 5 pages) → text → parseReceipt()
              └── ClaudeEngine: image/PDF block in → structured JSON (ExtractionResult) out
```

- All database access goes through the user's Supabase session, so **RLS enforces household isolation**. The service-role key is not used by the app.
- Files go straight from the browser to Storage. This avoids Vercel's ~4.5 MB request body limit. Route handlers download them from Storage for OCR.
- Both engines return the same shape:

```ts
type Field<T> = { value: T | null; confidence: number };   // 0..1
type ExtractionResult = {
  engine: "vision" | "claude";
  rawText: string | null;
  receiptNo: Field<string>; purchaseDate: Field<string>;     // YYYY-MM-DD
  storeName: Field<string>; storeAddress: Field<string>;
  subtotal: Field<number>; tax: Field<number>; total: Field<number>;
  currency: Field<string>; paymentMethod: Field<string>; cardLast4: Field<string>;
  items: { description: string; quantity: number; unitPrice: number | null; lineTotal: number | null; confidence: number }[];
  warnings: string[];   // e.g. "items sum 45.10 ≠ subtotal 47.10"
};
```

### 3.1 Text parser (`src/lib/parse-receipt.ts`, extended)
The parser already extracts the merchant, date (DMY/MDY), total and currency. It will be extended with:
- **Receipt no.:** label regex `(receipt|rcpt|invoice|inv|bill|txn|trans)\s*(no|#|number)?[:\s]*([A-Z0-9-]+)`.
- **Store address:** lines with `Singapore \d{6}` or address keywords near the top.
- **Subtotal / tax:** `subtotal|sub total`, `gst|tax|vat`.
- **Payment:** `visa|mastercard|amex|nets|paynow|cash` + `\*{4}\d{4}`.
- **Items:** lines between the header and the subtotal that end in a price. Optional qty patterns (`2 x`, `2 @ 3.50`).
- **Validation:** the sum of items is compared with the subtotal, and subtotal + tax with the total. A mismatch adds a warning and lowers the confidence.

### 3.2 Claude engine
- The model is configurable with `CLAUDE_MODEL` (default `claude-sonnet-5-5`). Images are sent as image blocks and PDFs as document blocks. Structured output matches `ExtractionResult`.
- It runs only when the user chooses it. The UI notes that the file is sent to Anthropic.

## 4. Data model (Supabase Postgres) — `supabase/migrations/0002_households_items.sql`

**One household per user.** Every data table has `household_id uuid not null default public.my_household_id()`, and its RLS policy is `household_id = (select public.my_household_id())`. `my_household_id()` is a `security definer` function that returns the caller's household. Composite foreign keys `(id, household_id)` make it impossible to link rows across households.

```
household          id, name, default_currency 'SGD', tax_label 'GST', expiry_window_days 30,
                   default_ocr_engine 'vision', time_zone 'Asia/Singapore' (validated by trigger)
household_member   household_id, user_id UNIQUE, role 'owner'|'member', joined_at
household_invite   id, household_id, code (8 chars, no 0/O/1/I), created_by, expires_at (+7 days), used_by, used_at

file        id, household_id, sha256, storage_path (must start with "<household_id>/"), original_name, mime, size, created_by
            UNIQUE (household_id, sha256)
receipt     id, household_id, file_id, ocr_engine 'vision'|'claude'|'manual', raw_text,
            receipt_no, purchase_date, store_name, store_address, subtotal, tax, total numeric(12,2),
            currency 'SGD' (3 letters), payment_method, card_last4, notes,
            warranty_months 0..1200, warranty_start, contact_id, created_by, created_at, updated_at
item        id, receipt_id (cascade), household_id, position, description, quantity > 0, unit_price, line_total,
            model_no, serial_no, notes, warranty_months, warranty_start, contact_id, no_warranty
contact     id, household_id, name, company, phone, email, address, website, notes
tag         id, household_id, name (unique per household, case-insensitive), color '#rrggbb'
item_tag    item_id, tag_id, household_id
attachment  id, item_id (cascade), file_id (cascade), household_id, kind 'warranty_card'|'manual'|'photo'|'other', label
```

**Household lifecycle** (RPCs; tables have no insert/delete policies for households or members):
- A trigger on `auth.users` creates a household for every new sign-up, with the user as owner.
- `create_invite()` returns a single-use code for the caller's household. Members can list and revoke their household's open invites.
- `join_household(code)` moves the caller into the code's household. If they were the only member of their old household, that household is deleted, which is only allowed while it has no receipts or contacts. Otherwise they simply leave it.
- `leave_household()` moves the caller into a fresh, empty household. The shared data stays with the remaining members. The only member of a household cannot leave it.
- When an owner leaves, the longest-standing remaining member becomes owner.
- `household_members()` lists members with their emails (`auth.users` is not exposed).

Storage: the private bucket `receipts` (10 MB limit; JPEG/PNG/WebP/PDF) stores objects at `<household_id>/<uuid>.<ext>`. Policies allow members to read, upload and delete within their household's folder.

### 4.1 Effective warranty (view `item_warranty`, `security_invoker = true`, also returns `days_left`)
```
months   = coalesce(item.warranty_months, receipt.warranty_months)
start    = coalesce(item.warranty_start, receipt.warranty_start, receipt.purchase_date)
contact  = coalesce(item.contact_id, receipt.contact_id)
expires  = (start + make_interval(months => months))::date   -- Postgres clamps month ends (Jan 31 + 1 mo = Feb 28/29)
status   = none (no_warranty or no months/start) | expired | expiring (≤ expiry_window_days) | active
```
"Today" uses the household's `time_zone`. Every screen and export reads this view.

## 5. Server surface (route handlers + server actions)

| Kind | Name | Purpose |
|---|---|---|
| Route | `POST /api/extract` `{fileId, engine}` | Runs OCR on an uploaded file and returns `ExtractionResult` plus duplicate matches. **It does not save a receipt.** It replaces the current `/api/ocr`, which inserts straight away |
| Action | `registerUpload(sha256, path, name, mime, size)` | Creates the `file` row, or returns the existing one (an exact duplicate warning) |
| Action | `saveReceipt(payload)` | Inserts the receipt, items, item tags (creating new tags by name) and the receipt/item warranty fields in one RPC transaction (`save_receipt` SQL function) |
| Action | `updateReceipt`, `deleteReceipt`, item/contact/tag CRUD, `setItemTags`, attachments | Editing |
| Action | `renameHousehold`, `createInvite`, `revokeInvite`, `joinHousehold(code)`, `leaveHousehold` | Household sharing (built in step 2, `/household`) |
| Route | `GET /api/export/csv?entity=items\|receipts&…filters` | CSV of the filtered view |
| Route | `GET /api/export/full` | A zip with JSON of every household table plus the original files |

Search and filters (store, item text, date range, tag, price range, warranty status) are applied server-side in Supabase queries on `item_warranty` joined to `item` and `receipt`.

## 6. Screens

1. **Dashboard:** items expiring soon, recently expired, recent receipts.
2. **Upload:** drag-and-drop for one or more images/PDFs, plus an engine toggle (Vision ◉ / Claude ○). Multiple files are processed in sequence and the user reviews each one.
3. **Review (key screen):** the original on the left (zoom; PDF viewer); editable header, items table with tag chips, totals with a ✔/⚠ reconciliation indicator, and highlighted low-confidence fields. There is a receipt-level warranty with a contact picker, and per-item panels for the warranty override, model/serial, contact and attachments. Buttons: **Save**, **Re-process with Claude**, **Discard**. A duplicate banner is shown when relevant.
4. **Items:** search and filter (tag, warranty status, date, store), plus bulk-tagging.
5. **Receipts:** a list (sorted by date, upload or total, and grouped by month, as the current home page does) and a detail page with the same layout as the review screen.
6. **Contacts**, **Tags**, **Household** (members, invite code), and **Settings** (defaults, exports).

## 7. Non-functional requirements

- Only server code sees the API keys (`import "server-only"`). Keys are never prefixed with `NEXT_PUBLIC_`.
- RLS is enabled on every table. Tests for policies cover a member versus a non-member of a household.
- Money is stored as `numeric`. In TS it is handled as numbers rounded to 2 dp only at the edges, and totals are reconciled in cents.
- Upload limit: 10 MB per file (bucket limit). Images are shrunk in the browser; PDFs are uploaded as-is.
- Free-tier limits: Vision's first 1,000 units a month are free (each PDF page counts as 1 unit); Supabase gives 500 MB DB and 1 GB storage, and pauses after about 1 week idle; OCR calls must finish within the Vercel function time limit.
- Tests: the parser with `node --test`. Migrations, RLS, invites and the warranty view are tested in SQL (`supabase/tests/`, `npm run test:db`) on plain Postgres with a stand-in for Supabase's `auth`/`storage` schemas.

## 8. Build plan

1. ✅ (from `main`) Next.js + Supabase + Vision skeleton: magic-link login, upload, basic parsing, receipt list with sort/group
2. ✅ Schema v2: households + invites, items, contacts, tags, attachments, `item_warranty` view, RLS, SQL tests; Household page; the existing upload and list moved to the new tables (grouping by `group_name` removed until tags arrive in step 4)
3. Upload → extract → **review screen** → save; extended parser; PDF support; duplicate checks
4. Warranty, contacts, tags and attachments UI; Items page
5. Dashboard (expiring items), search & filters
6. Claude engine + toggle / re-process
7. CSV export + full export

## 9. Resolved questions

1. **Joining a household:** a single-use invite code (valid 7 days) that the new member enters after signing in.
2. **Existing data:** the v1 app was never deployed, so migration 0002 drops the v1 `receipts` table instead of migrating it.
