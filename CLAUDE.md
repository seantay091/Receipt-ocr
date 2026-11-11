# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A cloud web app for a household to upload receipt photos and PDFs. It runs OCR, shows a review screen, and stores receipts and items. Each item has a warranty, a repair contact and tags. Stack: **Next.js 16 on Vercel + Supabase** (Postgres with RLS, magic-link Auth, Storage) **+ Google Vision OCR**, with Claude as an optional OCR engine.

`docs/REQUIREMENTS.md` is the agreed spec and low-level design: decisions, data model, server surface, screens and build plan (§8). Read it before adding features, and update it if a decision changes. Build steps 1–2 are done: the full v2 schema (households, items, warranties, contacts, tags, attachments) exists in the database, and the app has the Household page. The app still uses the interim receipts-only upload and list; the review screen, items, warranty, contacts and tags UI are not built yet.

**Next.js 16 has breaking changes from older versions** (see `AGENTS.md`). Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` rather than relying on memory. Examples: middleware is now `src/proxy.ts` exporting `proxy()`; `cacheComponents` is enabled in `next.config.ts`; pages take `PageProps<"/">` with an async `searchParams`. `next dev` re-adds a block to `AGENTS.md`; commit it rather than removing it.

## Commands

```bash
npm install
cp .env.example .env.local      # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, GOOGLE_VISION_API_KEY
npm run dev                     # http://localhost:3000
npm run build
npm run lint                    # eslint (next core-web-vitals + typescript)
npm test                        # node --test src/**/*.test.ts (Node runs the TS directly; no test framework)
node --test --test-name-pattern="ambiguous" src/lib/parse-receipt.test.ts   # single test
```

```bash
# SQL tests: migrations + RLS + invites + warranty view, on a throwaway database.
# Needs a plain Postgres 15+ superuser URL (NOT a Supabase project).
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db
```

`npm run build` needs the two `NEXT_PUBLIC_SUPABASE_*` vars to be set, but dummy values are enough. The database schema lives in `supabase/migrations/*.sql`. You apply it by running each file in order in the Supabase SQL Editor (or `supabase db push`); nothing applies migrations automatically. Add new numbered files rather than editing applied ones.

`scripts/test-db.sh` loads `supabase/tests/supabase_stub.sql` first: a stand-in for Supabase's `anon`/`authenticated` roles, `auth.users`, `auth.uid()` (reads `request.jwt.claims`), `storage.*` and default grants. It then runs every migration and every `supabase/tests/*_test.sql`. In tests, `test.as_user('alice')` switches to the `authenticated` role with that user's JWT, and each test is a `begin … rollback` block using `test.eq`, `test.ok` and `test.throws`. Add a test file for every new migration.

## Architecture

**Auth and data access.** `src/proxy.ts` runs on every non-static request. It refreshes the Supabase session cookie and redirects signed-out users to `/login`, or returns 401 for `/api/*`. Server code uses `createClient()` from `src/lib/supabase/server.ts` (cookie-bound, `server-only`); client components use `src/lib/supabase/client.ts`. All queries run as the signed-in user, and **RLS policies are the security boundary**. There is no service-role key, so never filter by household in app code as a substitute for a policy.

**Households (migration 0002).** Each user is in exactly one household (`household_member.user_id` is unique), and a sign-up trigger creates it. Every data table has `household_id` defaulting to `my_household_id()`, so inserts omit it. The RLS policy is `household_id = (select my_household_id())`. Composite FKs `(x_id, household_id)` block cross-household links, so a new table that references another needs the same pattern, plus `unique (id, household_id)` on the referenced table. Membership changes go only through the `security definer` RPCs `create_invite`, `join_household`, `leave_household` and `household_members`. `getHousehold()` in `src/lib/household.ts` loads the caller's household row.

**Upload → OCR flow.** `src/app/uploader.tsx` shrinks the image in the browser and uploads it straight to the private `receipts` Storage bucket at `<household-id>/<uuid>.jpg`. Storage policies only allow a household's own folder. This sidesteps Vercel's ~4.5 MB body limit. It then POSTs the storage path to `src/app/api/ocr/route.ts`. That route validates the path prefix, downloads the file and hashes it into a `file` row (a duplicate sha256 returns 409). It then calls Google Vision (`src/lib/ocr.ts`), parses the text with `parseReceipt` (`src/lib/parse-receipt.ts`, a pure function with unit tests), and inserts the `receipt` row. If OCR fails, the row is still saved so the user can type the details in. The spec replaces this with extract → review → save (`/api/extract` returns an `ExtractionResult` and does not insert).

**Mutations** are server actions in `src/app/actions.ts`. They validate `FormData` and call `revalidatePath("/")`. The home page (`src/app/page.tsx`) reads sort and view from `searchParams` and embeds each receipt's file with `select("*, file(storage_path, mime)")`. Household forms (`src/app/household/`) use `useActionState` with actions that return `{ error?, message? }`.

**Env.** `src/lib/supabase/env.ts` throws if the Supabase vars are missing. `GOOGLE_VISION_API_KEY` (and later `ANTHROPIC_API_KEY`) are server-only; never prefix them with `NEXT_PUBLIC_`. `RECEIPT_DATE_ORDER=MDY` switches the parser from the default day-first dates.

**Spec rules that should shape new code:** warranties are in months only; there is a receipt-level default with item overrides, and the effective warranty comes from one SQL view (`item_warranty`); tags are many-to-many on items; money is stored as `numeric`; SGD/GST are the defaults; the Claude engine runs only when the user picks it.
