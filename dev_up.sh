#!/usr/bin/env bash
# Bring the dev environment up from a cold container/machine in one command.
# (Container services don't survive suspend/resume; data on disk does.)
set -euo pipefail

service postgresql start 2>/dev/null || pg_ctlcluster 16 main start || true

su postgres -c "psql -tc \"select 1 from pg_roles where rolname='coach'\"" | grep -q 1 \
  || su postgres -c "psql -qc \"create role coach login password 'coach' superuser\""
su postgres -c "psql -tc \"select 1 from pg_database where datname='coachdb'\"" | grep -q 1 \
  || su postgres -c "createdb -O coach coachdb"

# Apply migrations via the tracked runner — schema_migrations records what's applied, so this
# is safe to re-run on fresh AND existing DBs (002 is Supabase-only; the runner skips it).
COACH_DB_URI="postgresql://coach:coach@localhost/coachdb" ./scripts/migrate.sh

echo "dev environment up: postgres running, coachdb ready"
echo "  export COACH_DB_URI=postgresql://coach:coach@localhost/coachdb"
echo "  export COACH_SEED_DIR=/mnt/user-data/outputs/seed"
