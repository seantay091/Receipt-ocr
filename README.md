# Receipt OCR & Warranty Tracker

A local web app for a household to upload receipt photos and PDFs. It extracts the receipt number, date, store, items and prices, then tracks warranties and repair contacts for each item. Items are grouped with tags such as "Kitchen" or "Living Room".

See [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) for the full requirements and low-level design.

> **Status:** build step 1 of 6 (project skeleton, database schema, app shell). Uploading and OCR come next.

## Stack

- **Backend:** Python 3.12+, FastAPI, SQLAlchemy 2, Alembic, SQLite
- **Frontend:** React 18 + TypeScript + Vite
- **OCR:** Tesseract (default) or Claude (optional, needs an API key)

All data lives in `./data/` (`app.db` plus `files/`). There is **no login**, so only run the app on a trusted home network and never expose it to the internet.

## Run with Docker (recommended)

```bash
cp .env.example .env        # optional: add ANTHROPIC_API_KEY to enable Claude OCR
docker compose up -d --build
```

Open <http://localhost:8000> on this PC, or `http://<this-pc-ip>:8000` from another device on your Wi-Fi.

## Run without Docker (development)

Prerequisites: Python 3.12+, Node 20+, and (from build step 2) `tesseract` on your `PATH`.

```bash
# Backend: http://localhost:8000 (API under /api, docs at /docs)
cd backend
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt     # Windows: .venv\Scripts\pip
.venv/bin/python -m app                           # creates ./data and runs DB migrations

# Frontend dev server with hot reload: http://localhost:5173 (proxies /api to :8000)
cd frontend
npm install
npm run dev
```

To serve the built UI from FastAPI on a single port, run `npm run build` in `frontend/` and restart the backend.

## Tests

```bash
cd backend && .venv/bin/pytest
cd frontend && npm run typecheck
```

## Project layout

```
backend/
  app/
    main.py            FastAPI app factory, startup migrations, SPA serving
    config.py          settings (.env / environment variables)
    db.py              engine + session (SQLite, foreign keys on, WAL)
    models.py          ORM models: receipt, item, contact, tag, file, attachment, setting
    warranty_view.py   SQL view v_item_warranty (effective warranty + status per item)
    api/system.py      GET /api/health, GET /api/config
  alembic/             database migrations
  tests/
frontend/
  src/                 React app (routes for all screens; placeholders for later steps)
docs/REQUIREMENTS.md   requirements & low-level design
```

## Build plan

1. ✅ Project skeleton, schema & migrations, app shell
2. Upload and Tesseract OCR pipeline with the field parser
3. Review screen; saving receipts, items, tags and contacts
4. Warranty dashboard, search and filters
5. Claude OCR toggle and "Re-process with Claude"
6. CSV export, backup and restore
