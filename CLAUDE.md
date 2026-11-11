# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A local-only household web app: upload receipt photos/PDFs → OCR (Tesseract by default, Claude optional) → a review screen → stored receipts and items. Each item has a warranty, a repair contact and tags. `docs/REQUIREMENTS.md` is the agreed spec and low-level design (data model, API table, screens, decisions). Read it before adding features, and update it if a decision changes. Work proceeds by the 6-step build plan in `README.md`; step 1 (skeleton, schema, app shell) is done.

Fixed decisions that affect code: no authentication (LAN only), always a review screen before saving, warranty in **months only**, warranty set at receipt level with item-level overrides, many-to-many tags, one PDF = one receipt, originals kept forever, SGD/GST defaults. Claude OCR runs only when the user chooses it; there is no automatic fallback. It needs `ANTHROPIC_API_KEY` in `.env`.

## Commands

Backend (run from `backend/`; the venv lives at `backend/.venv`):

```bash
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m app                                   # serve on :8000 (migrates ./data/app.db on startup)
.venv/bin/pytest                                          # all tests
.venv/bin/pytest tests/test_models.py::test_status_buckets   # single test
.venv/bin/pytest -k clamping                              # by keyword
# New migration after changing models (point DATA_DIR at a throwaway dir so ./data is untouched):
DATA_DIR=/tmp/x .venv/bin/alembic upgrade head && DATA_DIR=/tmp/x .venv/bin/alembic revision --autogenerate -m "msg" --rev-id 0002
```

Frontend (run from `frontend/`):

```bash
npm install
npm run dev        # :5173, proxies /api → localhost:8000, listens on the LAN
npm run build      # tsc -b + vite build → frontend/dist (FastAPI serves it if present)
npm run typecheck
```

Docker: `docker compose up -d --build` → :8000, with data in `./data`. `TZ` defaults to Asia/Singapore.

There is no linter configured yet.

## Architecture

**App lifecycle (`backend/app/main.py`).** `create_app(settings)` is a factory. Its lifespan creates the data dirs, runs `alembic upgrade head` programmatically (`app/migrate.py`), and then calls `db.init_engine()`. The engine and sessionmaker are module globals in `app/db.py`, and routes get sessions via `Depends(get_session)`. Settings are injected with `app.dependency_overrides[get_settings]`, so routes must use `Depends(get_settings)`, not call `get_settings()` directly. The SPA catch-all route is registered last and returns 404 for unknown `/api/*` paths. New API routers go in `app/api/` and are included with `prefix="/api"`.

**Schema is migration-driven.** Alembic, not `Base.metadata.create_all`, owns the schema; the app never calls `create_all`. After changing `models.py`, autogenerate a new revision and review it. `env.py` uses `render_as_batch=True` because SQLite needs batch mode for ALTERs. Migrations must not import mutable app constants: seed data is copied into the migration, as `INITIAL_SETTINGS` is in `0001`. The SQLite connection enables `PRAGMA foreign_keys=ON`, so `ondelete` cascades are real.

**Effective warranty lives in SQL (`app/warranty_view.py` → view `v_item_warranty`).** This view is the single source of truth for an item's months, start date, `expires_on`, contact and status (`none|expired|expiring|active`). It applies the fallbacks: item → receipt → purchase date, with `no_warranty` opting out. It also clamps month ends by hand, because SQLite's `date(x,'+N months')` overflows. The `expiring` window reads `setting.expiry_window_days` live. The dashboard, filters and exports should query this view and not reimplement the logic. Changing the view needs a new migration that drops and recreates it. The view returns dates as ISO strings, because SQLite stores `Date` columns as text.

**Money** is `Numeric(12,2)` with `Decimal` throughout; never use floats.

**Settings** come from two places. Runtime config (`app/config.py`, pydantic-settings) is read from the environment or from `.env` at the repo root or in `backend/`; `DATA_DIR` defaults to `<repo>/data`. User-editable preferences live in the DB `setting` table, with defaults in `models.DEFAULT_SETTINGS`. `/api/config` merges both for the frontend, and the frontend loads it once through `ConfigContext`.

**Planned OCR design** (step 2+, see REQUIREMENTS §3): both engines implement one `OcrEngine.extract(path, mime) -> ExtractionResult` interface, with a per-field confidence. `POST /api/uploads` stores the file deduplicated by sha256 (`data/files/<sha256>.<ext>`, path relative to `files_dir`) and returns the extraction without saving a receipt. `POST /api/receipts` saves the reviewed data.

## Testing conventions

The `client` fixture in `tests/conftest.py` builds the app against a tmp `DATA_DIR`. Entering the `TestClient` context runs the lifespan, which applies the migrations. The `session` fixture depends on `client`, so model and view tests run against the real migrated schema, view included. Use `Settings(data_dir=..., frontend_dist=..., anthropic_api_key=...)` to build variant apps.
