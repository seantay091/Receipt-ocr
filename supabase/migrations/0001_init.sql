-- Receipt OCR schema. Run this once in Supabase → SQL Editor (or `supabase db push`).

-- ---------------------------------------------------------------------------
-- Receipts table
-- ---------------------------------------------------------------------------
create table if not exists public.receipts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  image_path    text not null,            -- path inside the "receipts" storage bucket
  merchant      text,
  purchase_date date,
  total         numeric(12, 2),
  currency      text,
  group_name    text,                     -- the user's own grouping, e.g. "Travel", "Groceries"
  raw_text      text,                     -- full OCR output, kept for re-parsing / search
  created_at    timestamptz not null default now()
);

create index if not exists receipts_user_date_idx  on public.receipts (user_id, purchase_date desc);
create index if not exists receipts_user_group_idx on public.receipts (user_id, group_name);

alter table public.receipts enable row level security;

drop policy if exists "Users manage their own receipts" on public.receipts;
create policy "Users manage their own receipts"
  on public.receipts for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Private storage bucket for receipt photos.
-- Files are stored as "<user_id>/<uuid>.jpg"; users can only touch their own folder.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "Users read own receipt images" on storage.objects;
create policy "Users read own receipt images"
  on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users upload own receipt images" on storage.objects;
create policy "Users upload own receipt images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users delete own receipt images" on storage.objects;
create policy "Users delete own receipt images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
