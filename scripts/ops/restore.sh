#!/bin/sh
# Restores a dump from backup.sh into a database.
#
#   scripts/ops/restore.sh <dump-file> <target-database>
#
# The target database is created if missing and its existing objects are replaced, so point it at a NEW database
# to inspect a backup, or at the real one only when you mean to roll back. Connection variables as in backup.sh;
# BACKUP_DOCKER_CONTAINER runs the tools inside that container.
set -eu

DUMP="${1:?usage: restore.sh <dump-file> <target-database>}"
TARGET="${2:?usage: restore.sh <dump-file> <target-database>}"
USER_NAME="${PGUSER:-funti3r_dev}"
MAINT_DB="${PGMAINTDB:-postgres}"

[ -f "$DUMP" ] || { echo "no such file: $DUMP" >&2; exit 1; }

# Refuse a file that does not match its recorded checksum (a truncated or tampered copy).
if [ -f "$DUMP.sha256" ]; then
  ( cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256" >/dev/null ) || { echo "checksum mismatch: $DUMP" >&2; exit 1; }
fi

if [ -n "${BACKUP_DOCKER_CONTAINER:-}" ]; then
  C="docker exec -i $BACKUP_DOCKER_CONTAINER"
  $C psql -U "$USER_NAME" -d "$MAINT_DB" -tAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET'" | grep -q 1 \
    || $C psql -U "$USER_NAME" -d "$MAINT_DB" -c "CREATE DATABASE \"$TARGET\""
  $C pg_restore -U "$USER_NAME" -d "$TARGET" --clean --if-exists --no-owner < "$DUMP"
else
  psql -d "$MAINT_DB" -tAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET'" | grep -q 1 \
    || psql -d "$MAINT_DB" -c "CREATE DATABASE \"$TARGET\""
  pg_restore -d "$TARGET" --clean --if-exists --no-owner "$DUMP"
fi
echo "restored $DUMP into $TARGET"
