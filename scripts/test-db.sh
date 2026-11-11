#!/usr/bin/env bash
# Runs the Supabase migrations and SQL tests against a throwaway database.
#
#   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db
#
# TEST_DATABASE_URL must point at a plain Postgres 15+ server as a superuser
# (NOT a Supabase project: the test stub creates its own auth/storage schemas).
# A database named receipt_ocr_test_<pid> is created and dropped afterwards.
set -euo pipefail

: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to a superuser URL of a plain Postgres 15+ server}"
root="$(cd "$(dirname "$0")/.." && pwd)"
db="receipt_ocr_test_$$"

psql "$TEST_DATABASE_URL" -qX -v ON_ERROR_STOP=1 -c "create database $db" >/dev/null
trap 'psql "$TEST_DATABASE_URL" -qX -c "drop database if exists $db with (force)" >/dev/null' EXIT

# -o /dev/null hides query results; \echo progress lines and errors still show.
run() { PGOPTIONS="-c client_min_messages=warning" psql "$TEST_DATABASE_URL" -qX -v ON_ERROR_STOP=1 -o /dev/null -c "\\connect $db" -f "$1"; }

run "$root/supabase/tests/supabase_stub.sql"
for m in "$root"/supabase/migrations/*.sql; do run "$m"; done
for t in "$root"/supabase/tests/*_test.sql; do echo "== $(basename "$t")"; run "$t"; done
