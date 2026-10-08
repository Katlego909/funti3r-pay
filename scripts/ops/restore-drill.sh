#!/bin/sh
# Proves a backup actually restores: takes a fresh backup, restores it into a throwaway database and compares the
# row count of every table with the live one. Run it regularly (CI does); a backup nobody has restored is a hope.
#
#   scripts/ops/restore-drill.sh            (same connection variables as backup.sh)
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
DRILL_DB="funti3r_restore_drill_$$"
DB="${PGDATABASE:-funti3r_dev}"
USER_NAME="${PGUSER:-funti3r_dev}"
trap 'rm -rf "$WORK"; drop_drill_db' EXIT

run_sql() { # run_sql <database> <sql>
  if [ -n "${BACKUP_DOCKER_CONTAINER:-}" ]; then
    docker exec -i "$BACKUP_DOCKER_CONTAINER" psql -U "$USER_NAME" -d "$1" -tAc "$2"
  else
    psql -d "$1" -tAc "$2"
  fi
}
drop_drill_db() { run_sql "${PGMAINTDB:-postgres}" "DROP DATABASE IF EXISTS \"$DRILL_DB\"" >/dev/null 2>&1 || true; }

sh "$HERE/backup.sh" "$WORK"
DUMP="$(ls "$WORK"/funti3r-*.dump | head -1)"
sh "$HERE/restore.sh" "$DUMP" "$DRILL_DB"

# Same tables, same number of rows, in the live database and in the restored copy.
TABLES="$(run_sql "$DB" "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")"
FAILED=0
for T in $TABLES; do
  LIVE="$(run_sql "$DB" "SELECT count(*) FROM \"$T\"")"
  COPY="$(run_sql "$DRILL_DB" "SELECT count(*) FROM \"$T\"")"
  if [ "$LIVE" != "$COPY" ]; then echo "MISMATCH $T: live=$LIVE restored=$COPY" >&2; FAILED=1; fi
done
[ "$FAILED" = 0 ] || { echo "restore drill FAILED" >&2; exit 1; }
echo "restore drill passed: $(echo "$TABLES" | wc -w | tr -d ' ') tables restored with matching row counts"
