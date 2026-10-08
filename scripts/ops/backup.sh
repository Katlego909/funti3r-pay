#!/bin/sh
# Dumps the database to a verified, timestamped file and prunes old ones.
#
#   scripts/ops/backup.sh [destination-dir]          (default ./backups)
#
# Connection: the usual PG* variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE), or set
# BACKUP_DOCKER_CONTAINER=funti3r-postgres to run pg_dump inside that container (local development).
#
# BACKUP_KEEP_DAYS    how many days of dumps to keep (default 14)
# BACKUP_UPLOAD_CMD   optional command run with the dump's path as its last argument, to copy it off this machine,
#                     e.g. "aws s3 cp --only-show-errors" or "rclone copyto"-style wrappers. A failed upload fails the backup.
#
# A dump on the same disk as the database protects against mistakes, not against losing the machine: set an upload.
set -eu

DEST="${1:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DEST/funti3r-$STAMP.dump"
DB="${PGDATABASE:-funti3r_dev}"
USER_NAME="${PGUSER:-funti3r_dev}"

mkdir -p "$DEST"

if [ -n "${BACKUP_DOCKER_CONTAINER:-}" ]; then
  docker exec "$BACKUP_DOCKER_CONTAINER" pg_dump -U "$USER_NAME" -d "$DB" -Fc --no-owner > "$FILE.partial"
else
  pg_dump -d "$DB" -Fc --no-owner > "$FILE.partial"
fi

# A dump that cannot be listed is not a backup: check it before it replaces anything.
if [ -n "${BACKUP_DOCKER_CONTAINER:-}" ]; then
  docker exec -i "$BACKUP_DOCKER_CONTAINER" pg_restore --list < "$FILE.partial" > /dev/null
else
  pg_restore --list "$FILE.partial" > /dev/null
fi

mv "$FILE.partial" "$FILE"
( cd "$DEST" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256" )
echo "backup ok: $FILE ($(wc -c < "$FILE") bytes)"

if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
  # shellcheck disable=SC2086
  $BACKUP_UPLOAD_CMD "$FILE"
  echo "uploaded: $FILE"
fi

find "$DEST" -name 'funti3r-*.dump*' -mtime "+$KEEP_DAYS" -delete
