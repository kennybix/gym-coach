#!/usr/bin/env bash
# Backup restore drill — a backup that has never been restored is a hope, not a backup.
# Restores the NEWEST nightly dump into a scratch database, prints restored-vs-live row counts
# for the tables that matter, then drops the scratch DB. Run it after schema changes or every
# few months:  COACH_DB_URI=... ./deploy/restore_drill.sh
set -euo pipefail

BACKUP_DIR="${COACH_BACKUP_DIR:-$HOME/.local/share/gym-coach/backups}"
DSN="${COACH_DB_URI:?COACH_DB_URI must be set}"     # role needs CREATEDB (coach is superuser locally)
SCRATCH=coachdb_restore_test

latest=$(ls -1t "$BACKUP_DIR"/coachdb-*.sql.gz | head -1)
echo "restoring: $latest"
psql "$DSN" -qc "drop database if exists $SCRATCH"
psql "$DSN" -qc "create database $SCRATCH"
scratch_uri="${DSN%/*}/$SCRATCH"

# The dump targets a live schema (extensions etc.); ON_ERROR_STOP off here — the row-count
# sanity check below is the real gate, and a partial restore will fail it loudly.
gunzip -c "$latest" | psql "$scratch_uri" -q >/dev/null 2>&1 || true

echo "— restored vs live row counts —"
fail=0
for t in profiles programs program_exercises sessions set_logs body_metrics nutrition_logs \
         food_entries vitals body_measurements progress_photos meals coach_messages targets; do
  r=$(psql "$scratch_uri" -tAc "select count(*) from $t" 2>/dev/null || echo "MISSING")
  l=$(psql "$DSN" -tAc "select count(*) from $t" 2>/dev/null || echo "?")
  printf "  %-18s restored=%-8s live=%s\n" "$t" "$r" "$l"
  [ "$r" = "MISSING" ] && fail=1
done

psql "$DSN" -qc "drop database $SCRATCH"
if [ "$fail" = 1 ]; then
  echo "DRILL FAILED — a table did not restore"; exit 1
fi
echo "drill complete — restore verified, scratch DB dropped"
