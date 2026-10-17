#!/usr/bin/env bash
set -euo pipefail
test "${ISOLATED_PG_ONLY:-}" = "1"
test "${PGHOST:-}" = "127.0.0.1"
test "${PGDATABASE:-}" = "service_desk_security_test"
mkdir -p .qa-evidence
npm ci --ignore-scripts --no-audit --no-fund
npm run build
temp="$(mktemp -d)"
pid=""
cleanup(){ if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi; rm -rf "$temp"; }
trap cleanup EXIT
openssl req -newkey rsa:2048 -nodes -x509 -days 1 -keyout "$temp/key.pem" -out "$temp/cert.pem" -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost" >/dev/null 2>&1
QA_TLS_KEY="$temp/key.pem" QA_TLS_CERT="$temp/cert.pem" node dist/tests/e2e/qa-https-server.js >.qa-evidence/https.log 2>&1 &
pid=$!
ready=0
for i in $(seq 1 40); do
 if curl -skf --max-time 2 https://localhost:3320/ >/dev/null; then ready=1; break; fi
 if ! kill -0 "$pid" 2>/dev/null; then cat .qa-evidence/https.log; exit 1; fi
 sleep 1
done
test "$ready" = "1" || { cat .qa-evidence/https.log; exit 1; }
python3 -m venv "$temp/venv"
"$temp/venv/bin/python" -m pip install -q playwright==1.56.0
"$temp/venv/bin/python" -m playwright install chromium >/dev/null
"$temp/venv/bin/python" tests/e2e/browser-flow.py 2>&1 | tee .qa-evidence/browser-flow.log
grep -Fx 'BROWSER_QA_HTTPS_TICKET_CREATE_RELOAD_LOGOUT_PASS=1' .qa-evidence/browser-flow.log
