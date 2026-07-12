#!/usr/bin/env bash
# Apply coach/migrations/*.sql exactly once each, recorded in schema_migrations.
# Replaces the hand-maintained filename list (dev_up.sh) and hand-applied psql runs — one command
# for fresh and existing databases alike:
#
#   COACH_DB_URI=postgresql://coach:coach@localhost/coachdb ./scripts/migrate.sh
#
# Notes: 002_rls_supabase.sql is Supabase-only and always skipped. Apply+record are two steps,
# not one transaction — if the process dies between them, re-running re-applies that migration
# (all migrations after 001 are IF NOT EXISTS-idempotent, so this is safe in practice).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${COACH_DB_URI:?COACH_DB_URI must be set}"
PSQL=(psql "$COACH_DB_URI" -v ON_ERROR_STOP=1 -qtA)

"${PSQL[@]}" -c "create table if not exists schema_migrations (
  filename   text primary key,
  applied_at timestamptz not null default now()
)" >/dev/null

applied=0
for f in coach/migrations/*.sql; do
  base=$(basename "$f")
  [ "$base" = "002_rls_supabase.sql" ] && continue
  if [ -z "$("${PSQL[@]}" -c "select 1 from schema_migrations where filename = '$base'")" ]; then
    echo "applying  $base"
    psql "$COACH_DB_URI" -v ON_ERROR_STOP=1 -q -f "$f"
    "${PSQL[@]}" -c "insert into schema_migrations (filename) values ('$base')" >/dev/null
    applied=$((applied + 1))
  fi
done
echo "done — $applied applied, $("${PSQL[@]}" -c 'select count(*) from schema_migrations') recorded total"
