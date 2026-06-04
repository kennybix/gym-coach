#!/usr/bin/env bash
# Bring the dev environment up from a cold container/machine in one command.
# (Container services don't survive suspend/resume; data on disk does.)
set -euo pipefail

service postgresql start 2>/dev/null || pg_ctlcluster 16 main start || true

su postgres -c "psql -tc \"select 1 from pg_roles where rolname='coach'\"" | grep -q 1 \
  || su postgres -c "psql -qc \"create role coach login password 'coach' superuser\""
su postgres -c "psql -tc \"select 1 from pg_database where datname='coachdb'\"" | grep -q 1 \
  || su postgres -c "createdb -O coach coachdb"

# Apply migrations only on a fresh DB (001 is not idempotent). 002 is Supabase-only.
if ! PGPASSWORD=coach psql -h localhost -U coach -d coachdb -tc \
     "select 1 from information_schema.tables where table_name='profiles'" | grep -q 1; then
  for f in coach/migrations/001_core.sql coach/migrations/003_targets_append_only.sql \
           coach/migrations/004_pgvector.sql; do
    PGPASSWORD=coach psql -h localhost -U coach -d coachdb -v ON_ERROR_STOP=1 -q -f "$f"
  done
  echo "migrations applied (001, 003, 004)"
fi

echo "dev environment up: postgres running, coachdb ready"
echo "  export COACH_DB_URI=postgresql://coach:coach@localhost/coachdb"
echo "  export COACH_SEED_DIR=/mnt/user-data/outputs/seed"
