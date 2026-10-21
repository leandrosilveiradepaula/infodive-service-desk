#!/usr/bin/env bash
# Real Supabase Auth E2E in ephemeral Factory PostgreSQL only.
# No managed services, credentials, migrations, production deployment.
set -euo pipefail
if [[ "$(printenv ISOLATED_PG_ONLY || true)" != "1" ||
      "$(printenv PGHOST || true)" != "127.0.0.1" ||
      "$(printenv PGPORT || true)" != "5432" ||
      "$(printenv PGDATABASE || true)" != "service_desk_security_test" ||
      "$(printenv PGUSER || true)" != "postgres" ||
      "$(printenv PGPASSWORD || true)" != "disposable-qa-only-password" ||
      "$(printenv SERVICE_DESK_QA_REAL_AUTH || true)" != "1" ||
      -z "$(printenv QA_TLS_KEY || true)" ||
      -z "$(printenv QA_TLS_CERT || true)" ||
      -z "$(printenv SERVICE_DESK_QA_PYTHON || true)" ]]; then
  echo "Refusing non-disposable real Supabase Auth E2E" >&2
  exit 2
fi
command -v docker >/dev/null
command -v psql >/dev/null
command -v createdb >/dev/null
command -v curl >/dev/null
test -f dist-web/index.html
test -f dist/tests/e2e/qa-https-live-auth-server.js
test -x "$SERVICE_DESK_QA_PYTHON"
mkdir -p .qa-evidence

auth_container=""
app_pid=""
cleanup(){
  if [[ -n "$app_pid" ]]; then kill "$app_pid" 2>/dev/null || true; wait "$app_pid" 2>/dev/null || true; fi
  if [[ -n "$auth_container" ]]; then docker rm -f "$auth_container" >/dev/null 2>&1 || true; fi
  dropdb -h 127.0.0.1 -p 5432 -U postgres --if-exists service_desk_auth_test >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Explicit search_path is essential for GoTrue v2.183 migrations: otherwise
# enum types can land in public but later migrations require auth.factor_type.
# This is a known upstream standalone/Postgres initialization incompatibility.
# Separate DB avoids colliding with the minimal auth.users placeholder
# already used by the isolated Service Desk RLS migration matrix.
createdb -h 127.0.0.1 -p 5432 -U postgres service_desk_auth_test

# Supabase's Docker Postgres image creates the auth namespace during its
# bootstrap. A plain postgres:16 Actions service does not: establish only
# that isolated schema before allowing GoTrue to run its own migrations.
PGDATABASE=service_desk_auth_test psql -X -w -v ON_ERROR_STOP=1 \
  -c 'create schema if not exists auth; create extension if not exists pgcrypto;' >/dev/null

# Official GoTrue image pinned by immutable multi-platform manifest digest.
# v2.183.0; only a disposable loopback listener is created.
image="supabase/gotrue@sha256:9e067aef92d24f02ccd4415293cf6cbba23fb1172fc3c2209249ebbbcf3250d0"
auth_container="$(docker run --detach --network host \
  -e GOTRUE_API_HOST=127.0.0.1 \
  -e GOTRUE_API_PORT=3321 \
  -e GOTRUE_DB_DRIVER=postgres \
  -e GOTRUE_DB_DATABASE_URL="postgres://postgres:disposable-qa-only-password@127.0.0.1:5432/service_desk_auth_test?sslmode=disable&options=-csearch_path%3Dauth%2Cpublic" \
  -e GOTRUE_DB_NAMESPACE=auth \
  -e GOTRUE_SITE_URL="https://localhost:3320" \
  -e API_EXTERNAL_URL="http://127.0.0.1:3321" \
  -e GOTRUE_JWT_AUD=authenticated \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  -e GOTRUE_JWT_EXP=3600 \
  -e GOTRUE_JWT_SECRET="disposable-service-desk-postgrest-jwt-key-qa-only-64-characters-minimum" \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
  -e GOTRUE_MAILER_AUTOCONFIRM=true \
  -e GOTRUE_DISABLE_SIGNUP=false \
  "$image")"

auth_ready=0
for i in $(seq 1 50); do
  if curl --silent --fail --max-time 2 "http://127.0.0.1:3321/health" >/dev/null; then
    auth_ready=1
    break
  fi
  if ! docker inspect "$auth_container" --format '{{.State.Running}}' 2>/dev/null | grep -Fx true >/dev/null; then break; fi
  sleep 1
done
if [[ "$auth_ready" != "1" ]]; then
  # Never dump raw container logs: GoTrue may echo sensitive configuration.
  # Only publish bounded categories and process status for troubleshooting.
  startup_logs="$(docker logs "$auth_container" 2>&1 || true)"
  for category in "migration" "database" "connection" "configuration" "missing" "required" "JWT" "permission" "invalid" "fatal" "error"; do
    if grep -qi "$category" <<< "$startup_logs"; then
      echo "GOTRUE_STARTUP_HINT=$category" >&2
    fi
  done
  # Extract only bounded, redacted startup diagnostics. The database URL
  # and all key/token-like strings are scrubbed before printing CI evidence.
  docker logs "$auth_container" 2>&1 | python3 -c '
import re,sys
lines=sys.stdin.read(25000).splitlines()
for line in lines[-8:]:
 if not re.search(r"error|fatal|migration|database|panic",line,re.I): continue
 line=re.sub(r"postgres(?:ql)?://[^\\\" ]+","[database-url-redacted]",line,flags=re.I)
 line=re.sub(r"[A-Za-z0-9_+\\/=.-]{32,}","[long-value-redacted]",line)
 line=re.sub(r"(?i)(password|secret|token|apikey|authorization)\\s*[:=]\\s*[^,} ]+",r"\\1=[redacted]",line)
 print("SANITIZED_GOTRUE_STARTUP_LOG="+line[:400])
' || true
  exit_code="$(docker inspect "$auth_container" --format '{{.State.ExitCode}}' 2>/dev/null || true)"
  if [[ "$exit_code" =~ ^[0-9]+$ ]]; then echo "GOTRUE_EXIT_CODE=$exit_code" >&2; fi
  echo "Disposable pinned GoTrue did not become healthy; no auth assertions made" >&2
  exit 1
fi

"$SERVICE_DESK_QA_PYTHON" tests/e2e/bootstrap_real_auth_qa.py | tee .qa-evidence/gotrue-bootstrap.log
grep -Fx 'REAL_GOTRUE_PASSWORD_SIGNUP_AND_TENANT_FIXTURES_PASS=1' .qa-evidence/gotrue-bootstrap.log

node dist/tests/e2e/qa-https-live-auth-server.js >.qa-evidence/gotrue-https.log 2>&1 &
app_pid=$!
web_ready=0
for i in $(seq 1 35); do
  if curl --silent -k --fail --max-time 2 "https://localhost:3320/" >/dev/null; then
    web_ready=1
    break
  fi
  if ! kill -0 "$app_pid" 2>/dev/null; then break; fi
  sleep 1
done
if [[ "$web_ready" != "1" ]]; then
  echo "Disposable real GoTrue HTTPS gateway did not start" >&2
  exit 1
fi

"$SERVICE_DESK_QA_PYTHON" tests/e2e/browser-live-auth-flow.py 2>&1 | tee .qa-evidence/gotrue-browser.log
grep -Fx 'GOTRUE_REAL_PASSWORD_REFRESH_LOGOUT_PASS=1' .qa-evidence/gotrue-browser.log
grep -Fx 'BROWSER_QA_REAL_GOTRUE_RLS_TICKET_PASS=1' .qa-evidence/gotrue-browser.log
grep -Fx 'BROWSER_QA_NO_MANAGED_SUPABASE_CALLS=1' .qa-evidence/gotrue-browser.log
