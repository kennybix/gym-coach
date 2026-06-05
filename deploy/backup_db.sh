#!/usr/bin/env bash
# Nightly logical backup of the coach database, with rotation.
#
# Reads COACH_DB_URI from the environment (the systemd unit loads .env). Writes a
# gzip'd pg_dump to $COACH_BACKUP_DIR (default ~/.local/share/gym-coach/backups) and
# keeps the most recent $COACH_BACKUP_KEEP (default 14).
set -euo pipefail

: "${COACH_DB_URI:?COACH_DB_URI must be set}"
BACKUP_DIR="${COACH_BACKUP_DIR:-$HOME/.local/share/gym-coach/backups}"
KEEP="${COACH_BACKUP_KEEP:-14}"

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/coachdb-$stamp.sql.gz"

# --no-owner / --no-privileges keep the dump portable across roles on restore.
pg_dump --no-owner --no-privileges "$COACH_DB_URI" | gzip > "$out"
echo "backup written: $out ($(du -h "$out" | cut -f1))"

# Rotate: keep the newest $KEEP, delete the rest.
mapfile -t old < <(ls -1t "$BACKUP_DIR"/coachdb-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)))
if [ "${#old[@]}" -gt 0 ]; then
  printf '%s\n' "${old[@]}" | xargs -r rm -f
  echo "rotated out ${#old[@]} old backup(s), keeping $KEEP"
fi
