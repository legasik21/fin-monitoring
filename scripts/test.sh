#!/usr/bin/env bash
# Run the server test suite (node:test) inside node:22 against a THROWAWAY Postgres.
#
# The test DB is a disposable postgres:16-alpine container on its own temporary
# network with a tmpfs data dir; it is removed on exit and never touches the
# production containers. Everything runs in Docker because host Node is too old.
#
#   scripts/test.sh                      # whole suite (npm test in server/)
#   scripts/test.sh test/auth.test.js    # selected files (paths relative to server/)
#
# Migrations run ONCE here, before any test file starts; the `test` npm script
# must not migrate. node --test runs files in parallel against this one DB, so
# every test creates its own users (unique emails) and never truncates, drops or
# asserts on global row counts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=fin-monitoring-test-db
NET=fin-monitoring-test-net

# Serialise concurrent runs — they would fight over the fixed container name.
exec 9>"${TMPDIR:-/tmp}/fin-monitoring-test.lock"
flock 9

cleanup() {
  docker rm -f "$DB" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=fin_test \
  --tmpfs /var/lib/postgresql/data postgres:16-alpine >/dev/null

# Probe over TCP: during initdb the temporary server listens on the unix socket
# only, so a TCP answer means the real server is up.
for _ in $(seq 1 60); do
  docker exec "$DB" pg_isready -h 127.0.0.1 -U test -d fin_test >/dev/null 2>&1 && break
  sleep 1
done

if [ "$#" -gt 0 ]; then
  CMD=(sh -c 'node migrate.js && node --test "$@"' sh "$@")
else
  CMD=(sh -c 'node migrate.js && npm test --silent')
fi

docker run --rm --network "$NET" --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e TZ=Europe/Kyiv -e NODE_ENV=test \
  -e DATABASE_URL="postgres://test:test@$DB:5432/fin_test" \
  -e JWT_SECRET=test-only-jwt-secret-used-by-the-throwaway-suite-0123456789 \
  -v "$ROOT":/app -w /app/server node:22-bookworm-slim "${CMD[@]}"
