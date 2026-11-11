-- 0002: shared households, line items, warranties, repair contacts, tags and
-- attachments (docs/REQUIREMENTS.md §4). Run once after 0001 in the Supabase
-- SQL Editor (or `supabase db push`).
--
-- Ownership model: every user belongs to exactly ONE household, and every
-- data row carries household_id. RLS compares it with my_household_id(), so
-- all household members share everything and nobody else sees anything.
--
-- The v1 single-table schema was never deployed, so it is dropped rather
-- than migrated.

-- ---------------------------------------------------------------------------
-- Remove v1
-- ---------------------------------------------------------------------------
drop policy if exists "Users read own receipt images"   on storage.objects;
drop policy if exists "Users upload own receipt images" on storage.objects;
drop policy if exists "Users delete own receipt images" on storage.objects;
drop table if exists public.receipts;

-- ---------------------------------------------------------------------------
-- Households
-- ---------------------------------------------------------------------------
create table public.household (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null default 'My household' check (char_length(btrim(name)) between 1 and 80),
  default_currency   text not null default 'SGD' check (default_currency ~ '^[A-Z]{3}$'),
  tax_label          text not null default 'GST' check (char_length(btrim(tax_label)) between 1 and 20),
  expiry_window_days int  not null default 30 check (expiry_window_days between 0 and 365),
  default_ocr_engine text not null default 'vision' check (default_ocr_engine in ('vision', 'claude')),
  time_zone          text not null default 'Asia/Singapore',  -- "today" for warranty status
  created_at         timestamptz not null default now()
);

create table public.household_member (
  household_id uuid not null references public.household (id) on delete cascade,
  user_id      uuid not null unique references auth.users (id) on delete cascade,  -- one household per user
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.household_invite (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  code         text not null unique check (code ~ '^[A-Z2-9]{8}$'),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  used_by      uuid references auth.users (id) on delete set null,
  used_at      timestamptz
);
create index household_invite_household_idx on public.household_invite (household_id);

-- The caller's household. SECURITY DEFINER so RLS policies can call it
-- without recursing into household_member's own policy.
create function public.my_household_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.household_id from public.household_member m where m.user_id = (select auth.uid())
$$;

-- Reject unknown time zones up front, so the warranty view can't start failing.
create function public.check_household_time_zone() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform now() at time zone new.time_zone;  -- raises "time zone ... not recognized"
  return new;
end $$;
create trigger household_time_zone_valid before insert or update of time_zone on public.household
  for each row execute function public.check_household_time_zone();

-- ---------------------------------------------------------------------------
-- Household lifecycle (internal helpers + RPCs called by the app)
-- ---------------------------------------------------------------------------
create function public._create_household_for(uid uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  insert into public.household default values returning id into hid;
  insert into public.household_member (household_id, user_id, role) values (hid, uid, 'owner');
  return hid;
end $$;

-- Remove uid from their household; if they were its owner, the longest-standing
-- remaining member becomes owner. Callers ensure other members remain.
create function public._remove_member(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare hid uuid; was_owner boolean;
begin
  delete from public.household_member where user_id = uid
    returning household_id, role = 'owner' into hid, was_owner;
  if was_owner then
    update public.household_member set role = 'owner'
    where (household_id, user_id) = (
      select household_id, user_id from public.household_member
      where household_id = hid order by joined_at, user_id limit 1);
  end if;
end $$;

-- Every new sign-up gets their own household.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public._create_household_for(new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users who signed up while v1 was in use.
select public._create_household_for(u.id)
from auth.users u
where not exists (select 1 from public.household_member m where m.user_id = u.id);

-- Create a single-use invite code (valid 7 days) for the caller's household.
-- Alphabet (32 chars) skips look-alikes 0/O and 1/I. Randomness comes from
-- gen_random_uuid() (strong RNG); bytes 6 and 8 hold version/variant bits and
-- are skipped. 256 is a multiple of 32, so each character is uniform.
create function public.create_invite() returns text
language plpgsql security definer set search_path = '' as $$
declare
  hid uuid := public.my_household_id();
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea; c text;
begin
  if hid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  loop
    b := uuid_send(gen_random_uuid());
    select string_agg(substr(alphabet, get_byte(b, i) % 32 + 1, 1), '' order by ord)
      into c
      from unnest(array[0, 1, 2, 3, 4, 5, 9, 10]) with ordinality as t(i, ord);
    begin
      insert into public.household_invite (household_id, code, created_by)
      values (hid, c, (select auth.uid()));
      return c;
    exception when unique_violation then
      -- astronomically unlikely; try another code
    end;
  end loop;
end $$;

-- Join the household that issued p_code. The caller leaves their current
-- household; if they were its only member it is deleted, which is only
-- allowed while it holds no receipts or contacts (so nothing is lost).
create function public.join_household(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  inv public.household_invite;
  old_hid uuid;
begin
  if uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;

  select * into inv from public.household_invite
  where code = upper(btrim(p_code)) and used_by is null and expires_at > now()
  for update;
  if not found then raise exception 'Invite code is invalid, used or expired' using errcode = 'P0002'; end if;

  select household_id into old_hid from public.household_member where user_id = uid;
  if old_hid = inv.household_id then
    raise exception 'You are already in this household' using errcode = 'P0001';
  end if;

  if old_hid is not null then
    if exists (select 1 from public.household_member where household_id = old_hid and user_id <> uid) then
      perform public._remove_member(uid);
    elsif exists (select 1 from public.receipt where household_id = old_hid)
       or exists (select 1 from public.contact where household_id = old_hid) then
      raise exception 'Your current household still has receipts or contacts. Delete them before joining another household.'
        using errcode = 'P0001';
    else
      delete from public.household where id = old_hid;
    end if;
  end if;

  insert into public.household_member (household_id, user_id, role) values (inv.household_id, uid, 'member');
  update public.household_invite set used_by = uid, used_at = now() where id = inv.id;
  return inv.household_id;
end $$;

-- Leave the shared household and start a fresh, empty one. The shared data
-- stays with the remaining members.
create function public.leave_household() returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); hid uuid := public.my_household_id();
begin
  if uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.household_member where household_id = hid and user_id <> uid) then
    raise exception 'You are the only member of this household' using errcode = 'P0001';
  end if;
  perform public._remove_member(uid);
  return public._create_household_for(uid);
end $$;

-- Members of the caller's household, with emails (auth.users is not exposed).
create function public.household_members()
returns table (user_id uuid, email text, role text, joined_at timestamptz, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, m.role, m.joined_at, m.user_id = (select auth.uid())
  from public.household_member m join auth.users u on u.id = m.user_id
  where m.household_id = public.my_household_id()
  order by m.joined_at, m.user_id
$$;

-- ---------------------------------------------------------------------------
-- Data tables. Composite foreign keys (id, household_id) make it impossible to
-- link rows across households, even with a guessed id.
-- ---------------------------------------------------------------------------
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create table public.contact (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.my_household_id() references public.household (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 200),
  company      text,
  phone        text,
  email        text,
  address      text,
  website      text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, household_id)
);
create index contact_household_idx on public.contact (household_id, name);

create table public.file (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null default public.my_household_id() references public.household (id) on delete cascade,
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path  text not null unique,  -- object name in the "receipts" bucket
  original_name text,
  mime          text not null,
  size          bigint not null check (size >= 0),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (household_id, sha256),
  unique (id, household_id),
  check (storage_path like household_id::text || '/%')
);

create table public.receipt (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null default public.my_household_id() references public.household (id) on delete cascade,
  file_id         uuid,
  ocr_engine      text check (ocr_engine in ('vision', 'claude', 'manual')),
  raw_text        text,
  receipt_no      text,
  purchase_date   date,
  store_name      text,
  store_address   text,
  subtotal        numeric(12, 2),
  tax             numeric(12, 2),
  total           numeric(12, 2),
  currency        text not null default 'SGD' check (currency ~ '^[A-Z]{3}$'),
  payment_method  text,
  card_last4      text check (card_last4 ~ '^\d{4}$'),
  notes           text,
  -- receipt-level warranty defaults; items inherit unless they override
  warranty_months int check (warranty_months between 0 and 1200),
  warranty_start  date,
  contact_id      uuid,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, household_id),
  foreign key (file_id, household_id)    references public.file (id, household_id)    on delete set null (file_id),
  foreign key (contact_id, household_id) references public.contact (id, household_id) on delete set null (contact_id)
);
create index receipt_household_date_idx on public.receipt (household_id, purchase_date desc);
create index receipt_duplicate_idx      on public.receipt (household_id, store_name, receipt_no, purchase_date);
create index receipt_file_idx           on public.receipt (file_id);
create index receipt_contact_idx        on public.receipt (contact_id);

create table public.item (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null,
  household_id    uuid not null default public.my_household_id() references public.household (id) on delete cascade,
  position        int  not null default 0,
  description     text not null check (char_length(btrim(description)) between 1 and 500),
  quantity        numeric(10, 3) not null default 1 check (quantity > 0),
  unit_price      numeric(12, 2),
  line_total      numeric(12, 2),
  model_no        text,
  serial_no       text,
  notes           text,
  -- overrides; NULL = inherit from the receipt
  warranty_months int check (warranty_months between 0 and 1200),
  warranty_start  date,
  contact_id      uuid,
  no_warranty     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, household_id),
  foreign key (receipt_id, household_id) references public.receipt (id, household_id) on delete cascade,
  foreign key (contact_id, household_id) references public.contact (id, household_id) on delete set null (contact_id)
);
create index item_receipt_idx   on public.item (receipt_id, household_id, position);
create index item_household_idx on public.item (household_id);
create index item_contact_idx   on public.item (contact_id);

create table public.tag (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.my_household_id() references public.household (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 50),
  color        text check (color ~ '^#[0-9a-fA-F]{6}$'),
  unique (id, household_id)
);
create unique index tag_household_name_idx on public.tag (household_id, lower(btrim(name)));

create table public.item_tag (
  item_id      uuid not null,
  tag_id       uuid not null,
  household_id uuid not null default public.my_household_id(),
  primary key (item_id, tag_id),
  foreign key (item_id, household_id) references public.item (id, household_id) on delete cascade,
  foreign key (tag_id, household_id)  references public.tag (id, household_id)  on delete cascade
);
create index item_tag_tag_idx on public.item_tag (tag_id);

create table public.attachment (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null,
  file_id      uuid not null,
  household_id uuid not null default public.my_household_id(),
  kind         text not null default 'other' check (kind in ('warranty_card', 'manual', 'photo', 'other')),
  label        text,
  created_at   timestamptz not null default now(),
  foreign key (item_id, household_id) references public.item (id, household_id) on delete cascade,
  foreign key (file_id, household_id) references public.file (id, household_id) on delete cascade
);
create index attachment_item_idx on public.attachment (item_id);
create index attachment_file_idx on public.attachment (file_id);

create trigger contact_updated_at before update on public.contact for each row execute function public.set_updated_at();
create trigger receipt_updated_at before update on public.receipt for each row execute function public.set_updated_at();
create trigger item_updated_at    before update on public.item    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Effective warranty per item (REQUIREMENTS §4.1). The single source of truth
-- for warranty status: dashboard, filters and exports all read this view.
-- security_invoker = true, so the caller's RLS applies to the underlying rows.
-- Postgres clamps month ends: 2024-01-31 + 1 month = 2024-02-29.
-- ---------------------------------------------------------------------------
create view public.item_warranty with (security_invoker = true) as
with eff as (
  select
    i.id                                                          as item_id,
    i.receipt_id,
    i.household_id,
    i.no_warranty,
    coalesce(i.warranty_months, r.warranty_months)                as months,
    coalesce(i.warranty_start, r.warranty_start, r.purchase_date) as start_date,
    coalesce(i.contact_id, r.contact_id)                          as contact_id,
    (now() at time zone h.time_zone)::date                        as today,
    h.expiry_window_days
  from public.item i
  join public.receipt r   on r.id = i.receipt_id and r.household_id = i.household_id
  join public.household h on h.id = i.household_id
),
calc as (
  select eff.*,
         case when no_warranty or months is null or start_date is null then null
              else (start_date + make_interval(months => months))::date
         end as expires_on
  from eff
)
select
  item_id,
  receipt_id,
  household_id,
  case when expires_on is null then null else months end     as months,
  case when expires_on is null then null else start_date end as start_date,
  expires_on,
  contact_id,
  case
    when expires_on is null                        then 'none'
    when expires_on < today                        then 'expired'
    when expires_on <= today + expiry_window_days  then 'expiring'
    else 'active'
  end                                                         as status,
  expires_on - today                                          as days_left
from calc;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.household        enable row level security;
alter table public.household_member enable row level security;
alter table public.household_invite enable row level security;
alter table public.contact          enable row level security;
alter table public.file             enable row level security;
alter table public.receipt          enable row level security;
alter table public.item             enable row level security;
alter table public.tag              enable row level security;
alter table public.item_tag         enable row level security;
alter table public.attachment       enable row level security;

-- Households: members read and edit settings; create/delete only via the functions above.
create policy "Members read their household" on public.household for select to authenticated
  using (id = (select public.my_household_id()));
create policy "Members update their household" on public.household for update to authenticated
  using (id = (select public.my_household_id())) with check (id = (select public.my_household_id()));

create policy "Members see co-members" on public.household_member for select to authenticated
  using (household_id = (select public.my_household_id()));

create policy "Members see invites" on public.household_invite for select to authenticated
  using (household_id = (select public.my_household_id()));
create policy "Members revoke invites" on public.household_invite for delete to authenticated
  using (household_id = (select public.my_household_id()));

-- Data: full access within the caller's household.
do $$
declare t text;
begin
  foreach t in array array['contact', 'file', 'receipt', 'item', 'tag', 'item_tag', 'attachment'] loop
    execute format(
      'create policy "Household members manage %1$s" on public.%1$I for all to authenticated
         using (household_id = (select public.my_household_id()))
         with check (household_id = (select public.my_household_id()))', t);
  end loop;
end $$;

-- Internal helpers are not callable through the API.
revoke execute on function public._create_household_for(uuid) from public, anon, authenticated;
revoke execute on function public._remove_member(uuid)        from public, anon, authenticated;
revoke execute on function public.handle_new_user()           from public, anon, authenticated;
revoke execute on function public.create_invite()             from public, anon;
revoke execute on function public.join_household(text)        from public, anon;
revoke execute on function public.leave_household()           from public, anon;
revoke execute on function public.household_members()         from public, anon;

-- ---------------------------------------------------------------------------
-- Storage: objects live at "<household_id>/<uuid>.<ext>" in the private
-- "receipts" bucket; members can read, add and delete their household's files.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Household members read files" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select public.my_household_id())::text);
create policy "Household members upload files" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select public.my_household_id())::text);
create policy "Household members delete files" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select public.my_household_id())::text);
