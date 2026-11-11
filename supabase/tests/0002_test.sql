-- Tests for 0002_households_items.sql. Run with scripts/test-db.sh.
-- Each test runs in its own transaction and rolls back. Inside a test,
-- test.as_user('alice') switches to the "authenticated" role with Alice's JWT,
-- exactly like a request through the Supabase API.
\set ON_ERROR_STOP 1
\set QUIET 1

-- ---------------------------------------------------------------------------
-- Harness
-- ---------------------------------------------------------------------------
create schema test;
grant usage on schema test to anon, authenticated;

create function test.uid(p_name text) returns uuid language sql stable security definer as $$
  select id from auth.users where email = p_name || '@example.com'
$$;

create function test.as_user(p_name text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', test.uid(p_name), 'role', 'authenticated')::text, true);
end $$;

create function test.as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;

create function test.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;

create function test.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', msg; end if;
end $$;

create function test.eq(got anyelement, want anyelement, msg text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAILED: % (got %, want %)', msg, got, want; end if;
end $$;

-- Asserts that p_sql raises an error whose message matches p_pattern (regex).
create function test.throws(p_sql text, p_pattern text, msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAILED: % (no error raised)', msg;
exception when others then
  if sqlerrm like 'FAILED:%' then raise; end if;
  if sqlerrm !~* p_pattern then
    raise exception 'FAILED: % (error "%" does not match /%/)', msg, sqlerrm, p_pattern;
  end if;
end $$;

grant execute on all functions in schema test to anon, authenticated;

-- Fixture users. The sign-up trigger gives each one a household.
insert into auth.users (email) values ('alice@example.com'), ('bob@example.com'), ('carol@example.com');

-- A receipt for the current user, returning its id.
create function test.receipt(p_store text default 'Shop', p_date date default '2026-01-15',
                             p_months int default null) returns uuid language sql as $$
  insert into public.receipt (store_name, purchase_date, warranty_months)
  values (p_store, p_date, p_months) returning id
$$;
grant execute on function test.receipt(text, date, int) to authenticated;

\echo '# households'

begin;
  select test.eq((select count(*) from public.household_member), 3::bigint, 'each sign-up gets a membership');
  select test.eq((select count(distinct household_id) from public.household_member), 3::bigint, 'separate households');
  select test.eq((select role from public.household_member where user_id = test.uid('alice')), 'owner', 'creator is owner');
  select test.eq((select default_currency || '/' || tax_label || '/' || expiry_window_days || '/' || default_ocr_engine
                  from public.household h join public.household_member m on m.household_id = h.id
                  where m.user_id = test.uid('alice')), 'SGD/GST/30/vision', 'household defaults');
rollback;

begin;
  select test.throws($$update public.household set time_zone = 'Mars/Olympus'$$, 'time zone', 'invalid time zone rejected');
rollback;

\echo '# isolation between households'

begin;
  select test.as_user('alice');
  select test.receipt('Alice Store');
  select test.eq((select household_id from public.receipt), public.my_household_id(), 'household_id defaults to mine');
  select test.eq((select count(*) from public.household), 1::bigint, 'sees only own household');

  select test.as_user('bob');
  select test.eq((select count(*) from public.receipt), 0::bigint, 'bob cannot see alice''s receipt');
  select test.eq((select count(*) from public.household_member), 1::bigint, 'bob sees only his membership');
  update public.receipt set store_name = 'hacked';
  delete from public.receipt;
  select test.throws(format($$insert into public.receipt (household_id, store_name) values (%L, 'x')$$,
                            (select household_id from public.household_member where user_id = test.uid('alice'))),
                     'row-level security', 'bob cannot insert into alice''s household');
  select test.throws($$update public.household set name = 'x' where false; insert into public.household default values$$,
                     'row-level security', 'households cannot be created directly');

  select test.as_user('alice');
  select test.eq((select store_name from public.receipt), 'Alice Store', 'alice''s receipt untouched by bob');
rollback;

begin;
  select test.as_anon();
  select test.eq((select count(*) from public.receipt), 0::bigint, 'anon sees nothing');
  select test.throws($$select public.create_invite()$$, 'permission denied', 'anon cannot create invites');
rollback;

begin;
  select test.as_user('alice');
  select test.throws($$select public._create_household_for(auth.uid())$$, 'permission denied', 'internal helper not callable');
  select test.throws($$select public._remove_member(auth.uid())$$, 'permission denied', 'internal helper not callable (2)');
rollback;

\echo '# cross-household links are impossible'

begin;
  select test.as_user('alice');
  create temp table ids as select test.receipt() as alice_receipt;
  grant select on ids to authenticated;
  insert into public.contact (name) values ('Alice Contact');
  update ids set alice_receipt = alice_receipt;  -- keep temp table referenced

  select test.as_admin();
  -- Even bypassing RLS, an item in bob's household cannot point at alice's receipt.
  select test.throws(format($$insert into public.item (receipt_id, household_id, description) values (%L, %L, 'x')$$,
                            (select alice_receipt from ids),
                            (select household_id from public.household_member where user_id = test.uid('bob'))),
                     'foreign key', 'item cannot reference another household''s receipt');
  select test.throws(format($$insert into public.receipt (household_id, contact_id) values (%L, %L)$$,
                            (select household_id from public.household_member where user_id = test.uid('bob')),
                            (select id from public.contact where name = 'Alice Contact')),
                     'foreign key', 'receipt cannot reference another household''s contact');
rollback;

\echo '# invites'

begin;
  select test.as_user('alice');
  create temp table inv (code text, hid uuid);
  grant all on inv to authenticated;
  insert into inv select public.create_invite(), public.my_household_id();
  select test.ok((select code ~ '^[A-HJ-NP-Z2-9]{8}$' from inv), 'code format');
  select test.receipt('Shared Store');

  select test.as_user('bob');
  select test.eq(public.join_household((select lower(code) from inv)), (select hid from inv),
                 'bob joins alice''s household (code is case-insensitive)');
  select test.eq((select store_name from public.receipt), 'Shared Store', 'bob sees shared receipt');
  select test.eq((select count(*) from public.household_members()), 2::bigint, 'two members');
  select test.eq((select string_agg(email || ':' || role || ':' || is_me, ',' order by email) from public.household_members()),
                 'alice@example.com:owner:false,bob@example.com:member:true', 'member list with emails');
  select test.eq((select count(*) from public.household_invite where used_by is not null), 1::bigint, 'invite marked used');

  select test.as_admin();
  select test.eq((select count(*) from public.household), 2::bigint, 'bob''s empty household was deleted');

  select test.as_user('carol');
  select test.throws($$select public.join_household((select code from inv))$$, 'invalid, used or expired', 'code is single-use');
  select test.throws($$select public.join_household('ZZZZZZZZ')$$, 'invalid, used or expired', 'unknown code');
  select test.eq((select count(*) from public.household_invite), 0::bigint, 'carol cannot see alice''s invites');
rollback;

begin;
  select test.as_user('alice');
  create temp table inv (code text);
  grant all on inv to authenticated;
  insert into inv select public.create_invite();
  select test.throws($$select public.join_household((select code from inv))$$, 'already in this household', 'cannot join own household');

  select test.as_admin();
  update public.household_invite set expires_at = now() - interval '1 minute';
  select test.as_user('bob');
  select test.throws($$select public.join_household((select code from inv))$$, 'invalid, used or expired', 'expired code');
rollback;

begin;
  select test.as_user('alice');
  create temp table inv (code text);
  grant all on inv to authenticated;
  insert into inv select public.create_invite();
  select test.as_user('bob');
  select test.receipt('Bob Store');
  select test.throws($$select public.join_household((select code from inv))$$, 'still has receipts',
                     'sole member with data cannot abandon it');
  select test.eq((select count(*) from public.receipt), 1::bigint, 'bob keeps his data');
rollback;

\echo '# leaving'

begin;
  select test.as_user('alice');
  select test.throws($$select public.leave_household()$$, 'only member', 'sole member cannot leave');
  create temp table inv (code text);
  grant all on inv to authenticated;
  insert into inv select public.create_invite();
  select test.receipt('Shared Store');
  select test.as_user('bob');
  select public.join_household((select code from inv));

  select test.as_user('alice');
  select test.ok(public.leave_household() is not null, 'owner leaves');
  select test.eq((select count(*) from public.receipt), 0::bigint, 'alice no longer sees shared data');
  select test.eq((select role from public.household_member), 'owner', 'alice owns her new household');

  select test.as_user('bob');
  select test.eq((select role from public.household_member), 'owner', 'bob promoted to owner');
  select test.eq((select count(*) from public.receipt), 1::bigint, 'shared data stays with bob');
rollback;

\echo '# tags, cascades'

begin;
  select test.as_user('alice');
  insert into public.tag (name) values ('Kitchen');
  select test.throws($$insert into public.tag (name) values (' kitchen ')$$, 'duplicate key', 'tag names unique per household, case-insensitive');
  select test.as_user('bob');
  insert into public.tag (name) values ('Kitchen');  -- other households may reuse the name

  select test.as_user('alice');
  create temp table r as select test.receipt() as id;
  grant select on r to authenticated;
  insert into public.item (receipt_id, description) select id, 'Kettle' from r;
  insert into public.item_tag (item_id, tag_id) select i.id, t.id from public.item i, public.tag t;
  delete from public.receipt where id = (select id from r);
  select test.eq((select count(*) from public.item), 0::bigint, 'items cascade with receipt');
  select test.eq((select count(*) from public.item_tag), 0::bigint, 'item tags cascade');
  select test.eq((select count(*) from public.tag), 1::bigint, 'tag itself remains');
rollback;

\echo '# warranty view'

begin;
  select test.as_user('alice');
  insert into public.contact (name) values ('Store Service'), ('Maker Service');
  create temp table r as select test.receipt('Denki', '2025-03-10', 24) as id;
  grant select on r to authenticated;
  update public.receipt set contact_id = (select id from public.contact where name = 'Store Service');
  insert into public.item (receipt_id, description, warranty_months, warranty_start, contact_id, no_warranty)
  select r.id, v.d, v.m, v.s::date, (select id from public.contact where name = v.c), v.nw
  from r, (values
    ('inherits',  null::int, null,         null,            false),
    ('overrides', 60,        '2025-04-01', 'Maker Service', false),
    ('opted-out', null,      null,         null,            true),
    ('leap',      1,         '2024-01-31', null,            false)
  ) as v(d, m, s, c, nw);

  select test.eq((select w.months || '|' || w.start_date || '|' || w.expires_on || '|' || c.name
                  from public.item_warranty w join public.item i on i.id = w.item_id join public.contact c on c.id = w.contact_id
                  where i.description = 'inherits'), '24|2025-03-10|2027-03-10|Store Service', 'inherits receipt defaults');
  select test.eq((select w.months || '|' || w.start_date || '|' || w.expires_on || '|' || c.name
                  from public.item_warranty w join public.item i on i.id = w.item_id join public.contact c on c.id = w.contact_id
                  where i.description = 'overrides'), '60|2025-04-01|2030-04-01|Maker Service', 'item overrides');
  select test.eq((select w.status || '|' || coalesce(w.months::text, 'null') || '|' || coalesce(w.expires_on::text, 'null')
                  from public.item_warranty w join public.item i on i.id = w.item_id
                  where i.description = 'opted-out'), 'none|null|null', 'no_warranty opts out');
  select test.eq((select w.expires_on from public.item_warranty w join public.item i on i.id = w.item_id
                  where i.description = 'leap'), '2024-02-29'::date, 'month-end clamp in leap year');
  select test.eq((select w.status from public.item_warranty w join public.item i on i.id = w.item_id
                  where i.description = 'leap'), 'expired', 'past expiry is expired');

  select test.as_user('bob');
  select test.eq((select count(*) from public.item_warranty), 0::bigint, 'view respects RLS');
rollback;

begin;
  select test.as_user('alice');
  create temp table r as select test.receipt('X', null, null) as id;
  grant select on r to authenticated;
  -- Start dates relative to "today" in the household time zone; months = 0 so expiry = start.
  insert into public.item (receipt_id, description, warranty_months, warranty_start)
  select r.id, v.d, 0, (now() at time zone 'Asia/Singapore')::date + v.offs
  from r, (values ('today', 0), ('in10', 10), ('in45', 45), ('yesterday', -1)) as v(d, offs);
  insert into public.item (receipt_id, description) select id, 'no-date' from r;

  select test.eq((select string_agg(i.description || '=' || w.status || coalesce(':' || w.days_left, ''), ',' order by i.description)
                  from public.item_warranty w join public.item i on i.id = w.item_id),
                 'in10=expiring:10,in45=active:45,no-date=none,today=expiring:0,yesterday=expired:-1',
                 'status buckets with default 30-day window');

  update public.household set expiry_window_days = 60;
  select test.eq((select w.status from public.item_warranty w join public.item i on i.id = w.item_id
                  where i.description = 'in45'), 'expiring', 'window follows household setting');
rollback;

\echo '# storage'

begin;
  select test.as_user('alice');
  insert into storage.objects (bucket_id, name) values ('receipts', public.my_household_id() || '/a.jpg');
  select test.throws(format($$insert into storage.objects (bucket_id, name) values ('receipts', %L)$$,
                            (select household_id from public.household_member where user_id = test.uid('bob')) || '/x.jpg'),
                     'row-level security', 'cannot upload into another household''s folder');
  select test.throws($$insert into storage.objects (bucket_id, name) values ('receipts', 'a.jpg')$$,
                     'row-level security', 'cannot upload outside a household folder');
  select test.as_user('bob');
  select test.eq((select count(*) from storage.objects), 0::bigint, 'bob cannot see alice''s files');
  select test.as_admin();
  select test.eq((select allowed_mime_types from storage.buckets where id = 'receipts'),
                 array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], 'bucket accepts PDFs');
rollback;

begin;
  select test.as_user('alice');
  select test.throws(format($$insert into public.file (sha256, storage_path, mime, size) values (%L, 'elsewhere/a.jpg', 'image/jpeg', 1)$$,
                            repeat('a', 64)), 'check constraint', 'file path must be inside household folder');
rollback;

\echo '# all passed'
