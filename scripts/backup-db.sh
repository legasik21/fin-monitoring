#!/usr/bin/env bash
# Daily logical backup of the fin-monitoring Postgres DB (crontab: 03:30 daily).
#
# Writes a gzip'd plain-SQL pg_dump to /home/claude/backups/fin-monitoring/
# as fin-monitoring-YYYYMMDD-HHMM.sql.gz and keeps the newest 14 dumps.
# Restore instructions: README.md → «Бекапи».
set -euo pipefail

# Dumps contain emails and password hashes — keep them private to this user.
umask 077

BACKUP_DIR=/home/claude/backups/fin-monitoring
CONTAINER=fin-monitoring-db
KEEP=14

mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/fin-monitoring-$(date +%Y%m%d-%H%M).sql.gz"
TMP="$OUT.partial"
trap 'rm -f "$TMP"' EXIT

# pg_dump runs inside the DB container with its own POSTGRES_USER / POSTGRES_DB,
# so no credentials live in this script or in cron. With pipefail a failing
# pg_dump aborts here instead of leaving a truncated dump behind.
docker exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip -9 > "$TMP"

# Only a complete, non-empty, valid gzip is kept and joins the rotation.
[ -s "$TMP" ] || { echo "[backup] empty dump, aborting" >&2; exit 1; }
gzip -t "$TMP"
mv "$TMP" "$OUT"

# Retention: keep the newest $KEEP dumps (the .partial/.log files never match).
ls -1t "$BACKUP_DIR"/fin-monitoring-*.sql.gz | tail -n +"$((KEEP + 1))" | xargs -r rm -f --

echo "[backup] $(date -Is) ok: $OUT ($(stat -c %s "$OUT") bytes)"
