# Receipt-ocr

Users upload photos of receipts. The app reads the **store, purchase date, total and currency** with OCR, and lets users sort receipts by purchase date. Receipts are shared by everyone in a **household**: each person signs in with their own email and joins with an invite code.

**Stack (all free tiers):**

| Part | Service |
| --- | --- |
| Web app + API (Next.js 16) | [Vercel](https://vercel.com) Hobby |
| Database, login (email magic link), photo storage | [Supabase](https://supabase.com) Free |
| OCR | [Google Cloud Vision](https://cloud.google.com/vision) (first 1,000 images/month free) |

## How it works

1. The user signs in with a magic link sent by Supabase Auth.
2. Every new user gets their own household. On the **Household** page they can create a one-time invite code (valid 7 days) for a family member, who enters it to join.
3. The browser shrinks the photo and uploads it straight to a private Supabase Storage bucket, in `receipts/<household-id>/…`.
4. `POST /api/ocr` downloads the photo, sends it to Google Vision, and parses the text (`src/lib/parse-receipt.ts`). It then saves a `file` row and a `receipt` row.
5. The home page lists the household's receipts. Users can sort by purchase date, upload time or total, and view them as one list or by month. Every field can be edited, since OCR is not always right.

Row-level security makes sure people only see their own household's receipts and photos.

> **Planned:** shared household accounts, line items, per-item warranties, repair contacts, tags, a review screen before saving, PDF support and an optional Claude OCR engine. See [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) for the full design and build plan.

## 1. Set up Supabase

1. Create a free project at <https://supabase.com/dashboard>.
2. Go to **SQL Editor** and run each file in [`supabase/migrations/`](supabase/migrations) **in order** (`0001_…`, then `0002_…`). Together they create the tables, the security policies, the household sign-up trigger and the `receipts` storage bucket.
3. Go to **Project Settings → API** and copy the **Project URL** and the **publishable** key. The legacy `anon` key also works.

## 2. Get a Google Vision API key

1. Open <https://console.cloud.google.com>, create a project, and **enable billing**. Google requires billing even for the free tier. You are only charged after 1,000 images a month, and you can set a budget alert to be safe.
2. Go to **APIs & Services → Library**, find **Cloud Vision API**, and enable it.
3. Go to **APIs & Services → Credentials → Create credentials → API key**. Then edit the key and under **API restrictions** limit it to **Cloud Vision API**.

## 3. Run locally

```bash
cp .env.example .env.local   # then fill in the three values
npm install
npm run dev                  # http://localhost:3000
npm test                     # receipt parser tests
```

Database tests (migrations, security policies, invites, warranty view) run against a plain local Postgres 15+ server, not a Supabase project:

```bash
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db
```

In Supabase, go to **Authentication → URL Configuration** and add `http://localhost:3000/**` to **Redirect URLs** so magic links work locally.

## 4. Deploy to Vercel

1. Push this repo to GitHub. Then on <https://vercel.com/new>, import it. Vercel detects Next.js on its own.
2. Under **Environment Variables**, add the values from `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `GOOGLE_VISION_API_KEY`
   - optional: `RECEIPT_DATE_ORDER=MDY` if your receipts use US-style dates like `04/25/2026`. The default is day-first: `25/04/2026`.
3. Click **Deploy**.
4. In Supabase, go to **Authentication → URL Configuration**:
   - Set **Site URL** to your Vercel URL, for example `https://receipt-ocr.vercel.app`.
   - Add `https://receipt-ocr.vercel.app/**` to **Redirect URLs**. To make preview deployments work too, also add `https://*-<your-vercel-team>.vercel.app/**`.

From then on, every push to `main` redeploys on its own.

### Free-tier notes

- Supabase pauses free projects after about 1 week with no activity. To resume, open the dashboard and click **Restore**.
- Supabase's built-in email sender is rate-limited to a few emails per hour. That's fine for personal use. For more users, add custom SMTP (for example Resend's free tier) under **Authentication → Emails**.
- Storage: 1 GB free on Supabase. Photos are shrunk to a maximum of 2000 px (about 300–500 KB each) before upload.

## Project layout

```
src/
  proxy.ts                 # refreshes the auth session, redirects signed-out users to /login
  app/
    page.tsx               # receipt list with sort / month grouping
    household/             # members, invite codes, join / leave
    uploader.tsx           # photo shrink + upload + OCR call
    receipt-card.tsx       # view / edit / delete one receipt
    actions.ts             # server actions: update, delete, sign out
    api/ocr/route.ts       # Vision OCR + parse + insert
    login/, auth/callback/ # magic-link sign in
  lib/
    ocr.ts                 # Google Vision client
    parse-receipt.ts       # text → merchant / date / total / currency (+ tests)
    supabase/              # browser + server Supabase clients
supabase/migrations/       # SQL schema, RLS policies and storage bucket (run in order)
supabase/tests/            # SQL tests + a stand-in for Supabase's auth/storage schemas
scripts/test-db.sh         # runs migrations + SQL tests on a throwaway database
```
