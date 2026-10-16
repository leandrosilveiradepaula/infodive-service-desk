#!/usr/bin/env bash
# Disposable GitHub Actions QA only. Refuses all other database targets.
set -euo pipefail
if [[ "$ISOLATED_PG_ONLY" != "1" ||
      "$PGHOST" != "127.0.0.1" ||
      "$PGPORT" != "5432" ||
      "$PGDATABASE" != "service_desk_security_test" ||
      "$PGUSER" != "postgres" ||
      "$PGPASSWORD" != "disposable-qa-only-password" ]]; then
  echo "Refusing non-disposable REST contract target" >&2
  exit 2
fi
command -v docker >/dev/null || { echo "Docker unavailable for disposable PostgREST contract"; exit 2; }
command -v curl >/dev/null || { echo "curl unavailable"; exit 2; }
command -v python3 >/dev/null || { echo "Python missing"; exit 2; }
image="postgrest/postgrest@sha256:5f4ce744539bbba786b4e24dbbd95bdb2a956dcf568c5374995a0ff4a68f5bd2"
# Privileged role ONLY in disposable loopback test. RLS is separately checked by SQL.
container_id=""
cleanup() {
  if [[ -n "$container_id" ]]; then
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
container_id="$(docker run --detach --rm --network host \
  -e PGRST_DB_URI="postgres://postgres:disposable-qa-only-password@127.0.0.1:5432/service_desk_security_test" \
  -e PGRST_DB_ANON_ROLE=postgres \
  -e PGRST_DB_SCHEMAS=public \
  -e PGRST_SERVER_HOST=127.0.0.1 \
  -e PGRST_SERVER_PORT=3318 \
  "$image")"
ready=0
for attempt in $(seq 1 45); do
  if curl --silent --fail --max-time 2 "http://127.0.0.1:3318/" >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  echo "Disposable PostgREST did not become ready" >&2
  exit 1
fi
python3 tests/security/postgrest_membership_contract.py
