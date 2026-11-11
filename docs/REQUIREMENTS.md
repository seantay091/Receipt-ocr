# Receipt OCR & Warranty Tracker — Requirements & Low-Level Design

Status: **v1 — confirmed** (from requirements Q&A, 2026-11-11)

## 1. Summary

A local web app for a household to upload receipt photos and PDFs. It extracts receipt data with OCR, lets the user review and correct it, and tracks warranties and repair contacts for each purchased item. Items can be grouped with free-form tags such as "Kitchen" or "Living Room".

## 2. Decisions captured

| Topic | Decision |
|---|---|
| Users | Household, shared data, **no login** |
| Hosting | **Local only.** Runs on one PC and is reachable from other devices on the home LAN |
| Input | **Desktop upload** of images (JPG/PNG/HEIC/WebP) and **PDF / e-receipts** |
| OCR | **Open-source OCR by default.** The user can switch to **Claude** with a toggle on the upload page and a "Re-process with Claude" button on the review screen. No automatic fallback |
| Claude key | `ANTHROPIC_API_KEY` in a local `.env` file. If the key is missing, the Claude option is disabled |
| Review | **Always** show a review screen (original next to editable fields) before saving |
| Warranty | **Both levels:** a receipt-level default that each item can override |
| Repair contacts | Name/company, phone, email, address, website. **Reusable** contact records linked to receipts and items |
| Grouping | **Multiple tags per item** (many-to-many) |
| Receipt fields | Receipt no., date, store name & address, items, subtotal, tax (GST), total, payment method |
| Line items | Qty, unit price, line total, model no., serial no., **attachments** (warranty card, manual, photo) |
| Extras in v1 | Warranty expiry **in-app dashboard**, **search & filter**, **export/backup** |
| Duplicates | Warn on duplicates (same file hash, or same store + receipt no. + date) |
| Currency | Default **SGD**, tax label "GST" (both configurable) |
| Stack | **Python FastAPI + SQLite + React (Vite)** |
| Out of scope (v1) | Phone camera capture/PWA, spending reports, email alerts, calendar export, discount lines, multi-currency, authentication |

## 3. Architecture

```
Browser (React SPA) ──HTTP/JSON──> FastAPI (uvicorn, 0.0.0.0:8000)
                                      ├── SQLite (data/app.db, via SQLAlchemy + Alembic)
                                      ├── File store (data/files/<sha256>.<ext>)
                                      └── OCR pipeline
                                           ├── OpenSourceEngine: Tesseract (pytesseract) + rule-based parser
                                           │     PDFs: pdfplumber text layer → if empty, render pages with pypdfium2 → Tesseract
                                           └── ClaudeEngine: Anthropic API, image/PDF in → structured JSON out
```

- The frontend is built into static files and served by FastAPI, so there is a single process: `docker compose up` or `python -m app`.
- Image preprocessing before Tesseract (OpenCV/Pillow): EXIF rotation, grayscale, deskew, adaptive threshold, and upscaling to about 300 DPI. HEIC is supported through `pillow-heif`.
- OCR runs **synchronously per upload**. A receipt takes about 2–10 s, and the UI shows a spinner. A job queue can be added later if needed.
- Both engines implement one interface:

```python
class OcrEngine(Protocol):
    name: str  # "opensource" | "claude"
    def extract(self, file_path: Path, mime: str) -> ExtractionResult: ...

class ExtractionResult(BaseModel):
    raw_text: str | None
    receipt_no: Field[str]; purchase_date: Field[date]; store_name: Field[str]
    store_address: Field[str]; subtotal: Field[Decimal]; tax: Field[Decimal]
    total: Field[Decimal]; payment_method: Field[str]
    items: list[ExtractedItem]   # description, qty, unit_price, line_total (each with a confidence)
    warnings: list[str]          # e.g. "items sum 45.10 != subtotal 47.10"
# Field[T] = {value: T | None, confidence: float 0..1}
```

### 3.1 Open-source parser rules (initial)
- **Receipt no.:** regex on labels such as `(receipt|rcpt|invoice|inv|bill|txn|trans)\s*(no|#|number)?[:\s]*([A-Z0-9-]+)`.
- **Date:** multiple formats (`dd/mm/yyyy`, `dd-MMM-yy`, ISO …). Prefer day-first (SG locale) using `dateutil`.
- **Store name:** the first non-empty line(s) at the top. **Address:** lines that match a postal code (`Singapore \d{6}`) or address keywords.
- **Totals:** lines that match `subtotal|sub total`, `gst|tax`, `total|amount due|grand total`.
- **Payment:** keywords such as `visa|mastercard|amex|nets|paynow|cash` plus `\*{4}\d{4}` for the last 4 digits.
- **Items:** lines between the header and the subtotal that end in a price `\d+\.\d{2}`. Optional patterns: a leading qty (`2 x`, `2 @ 3.50`).
- **Validation:** the sum of line totals is compared with the subtotal, and subtotal + tax with the total. A mismatch adds a warning and lowers the confidence.

### 3.2 Claude engine
- The model is configurable with `CLAUDE_MODEL` (default `claude-sonnet-5-5`).
- Images are sent as image blocks and PDFs as document blocks. Structured output (a JSON schema matching `ExtractionResult`) is enforced through tool use or structured outputs.
- This engine is used only when the user explicitly chooses it. The UI shows a reminder that the file is sent to Anthropic.

## 4. Data model (SQLite)

```
receipt
  id PK, file_id FK→file, ocr_engine TEXT, raw_text TEXT,
  receipt_no TEXT, purchase_date DATE, store_name TEXT, store_address TEXT,
  subtotal NUMERIC, tax NUMERIC, total NUMERIC, currency TEXT DEFAULT 'SGD',
  payment_method TEXT, card_last4 TEXT, notes TEXT,
  -- receipt-level warranty defaults
  warranty_months INT NULL, warranty_start DATE NULL, contact_id FK→contact NULL,
  created_at, updated_at
  INDEX (store_name, receipt_no, purchase_date)

item
  id PK, receipt_id FK→receipt ON DELETE CASCADE, position INT,
  description TEXT NOT NULL, quantity NUMERIC DEFAULT 1, unit_price NUMERIC, line_total NUMERIC,
  model_no TEXT, serial_no TEXT, notes TEXT,
  -- overrides; NULL = inherit from receipt
  warranty_months INT NULL, warranty_start DATE NULL, contact_id FK→contact NULL,
  no_warranty BOOL DEFAULT 0      -- explicitly opt this item out of the receipt default

contact
  id PK, name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT,
  address TEXT, website TEXT, notes TEXT

tag             id PK, name TEXT UNIQUE COLLATE NOCASE, color TEXT
item_tag        item_id FK, tag_id FK, PK(item_id, tag_id)

file
  id PK, sha256 TEXT UNIQUE, original_name TEXT, mime TEXT, size INT, path TEXT, created_at

attachment
  id PK, item_id FK→item ON DELETE CASCADE, file_id FK→file,
  kind TEXT CHECK IN ('warranty_card','manual','photo','other'), label TEXT

setting         key TEXT PK, value TEXT   -- default_currency, tax_label, expiry_window_days, default_ocr_engine
```

### 4.1 Effective warranty (computed, not stored)
```
if item.no_warranty:          none
months   = item.warranty_months ?? receipt.warranty_months
start    = item.warranty_start  ?? receipt.warranty_start ?? receipt.purchase_date
contact  = item.contact_id      ?? receipt.contact_id
expires  = start + months (calendar months, clamped to month end)
status   = 'active' | 'expiring' (expires - today <= expiry_window_days, default 30) | 'expired' | 'none'
```
This logic lives in one SQL view (`v_item_warranty`), so the dashboard and filters share it.

## 5. REST API (`/api`)

| Method & path | Purpose |
|---|---|
| `POST /uploads?engine=opensource\|claude` | multipart file → stores the file (deduplicated by sha256), runs OCR → returns `{file_id, extraction, duplicates:[receipt summaries]}`. **Nothing is saved as a receipt yet** |
| `POST /uploads/{file_id}/reprocess?engine=claude` | runs OCR again with the other engine |
| `GET /files/{id}` | serves the original image or PDF |
| `POST /receipts` | creates a receipt and items from the reviewed payload (including tag names, which are created if new) |
| `GET /receipts?q=&store=&from=&to=&tag=&min=&max=&warranty=active\|expiring\|expired\|none&sort=&page=` | list/search |
| `GET/PUT/DELETE /receipts/{id}` | details (with items, effective warranty and tags) / update / delete |
| `POST/PUT/DELETE /items/{id}` (+ `POST /receipts/{id}/items`) | item CRUD |
| `PUT /items/{id}/tags` | replaces an item's tag set |
| `POST /items/{id}/attachments`, `DELETE /attachments/{id}` | extra documents |
| `GET /items?…same filters…` | item-centric search (the main view for "what's in my kitchen") |
| `GET/POST/PUT/DELETE /contacts`, `/tags` | manage reusable contacts and tags (renaming or merging a tag updates all items) |
| `GET /dashboard` | counts, items expiring in N days, recently expired, recent receipts |
| `GET /export/csv?entity=items\|receipts` | CSV of the filtered view |
| `GET /backup` | zip of `app.db` (consistent copy via the SQLite backup API) + `files/` |
| `POST /restore` | uploads a backup zip and replaces the data (with a confirmation step) |
| `GET /config` | `{claude_available: bool, default_engine, currency, tax_label}` |

Duplicate check on upload: an exact `sha256` match → strong warning. A match on store + receipt_no + date after extraction → soft warning on the review screen. The user can still save.

## 6. UI screens

1. **Dashboard:** cards for items expiring soon, recently expired items, totals by tag (counts only), and recent receipts.
2. **Upload:** drag-and-drop for one or more files, plus an engine toggle (Open-source ◉ / Claude ○; Claude is greyed out without a key). Multiple files are processed in sequence and the user reviews them in turn.
3. **Review (key screen):** the original image or PDF on the left (zoom/rotate); editable fields on the right:
   - Header: store, address, receipt no., date, payment method and last 4 digits.
   - An item table with inline editing and add/remove rows (description, qty, unit price, line total, tags as chips).
   - Totals with a ✔/⚠ reconciliation indicator. Low-confidence fields are highlighted.
   - Receipt-level warranty defaults (months, start date, contact picker or "new contact").
   - Per-item expandable panel: warranty override / "no warranty", model and serial number, contact, attachments.
   - Buttons: **Save**, **Re-process with Claude**, **Discard**, plus a duplicate warning banner.
4. **Items:** a searchable table filtered by tag, warranty status, date and store. Bulk-tagging is available.
5. **Receipts:** a list and a detail page (the same layout as the review screen, in edit mode).
6. **Contacts** and **Tags** management pages.
7. **Settings:** default engine, currency, tax label, expiry window, backup/restore, CSV export.

## 7. Non-functional requirements

- All data stays on the host under `./data/` except files sent to Claude when the user chooses it.
- There is no auth, so the app must bind to the LAN only. The docs warn against port-forwarding it to the internet.
- Upload limit 20 MB per file. Supported types: jpg, png, webp, heic, pdf.
- Money is stored as `NUMERIC`/`Decimal`, never as float.
- Testing: unit tests for the parser using sample receipt text fixtures; API tests with pytest + httpx; a mocked Claude client.
- Packaging: `Dockerfile` (with Tesseract installed) + `docker-compose.yml` mounting `./data`, plus a non-Docker dev setup (README).

## 8. Resolved decisions (formerly open questions)

1. **Original files:** all uploaded originals are **kept** under `data/files` and can be viewed from the receipt page.
2. **"Added by":** **dropped.** No user attribution is stored.
3. **Open-source OCR engine:** **Tesseract** in v1. PaddleOCR may be added later as an optional engine behind the same `OcrEngine` interface.
4. **PDFs:** **1 PDF = 1 receipt** in v1. All pages are OCR'd and their text joined.
5. **Warranty units:** **months only** (`warranty_months INT`).
