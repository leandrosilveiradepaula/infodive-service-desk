"""Create two REAL GoTrue password users in a disposable DB, then bind each
identity to the existing isolated Service Desk tenant fixtures.

All writes are to loopback PostgreSQL in a GitHub Actions service container,
never to managed Supabase. Do NOT export passwords, JWTs or refresh tokens.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import urllib.error
import urllib.request

EXPECTED = {
    "ISOLATED_PG_ONLY": "1",
    "PGHOST": "127.0.0.1",
    "PGPORT": "5432",
    "PGDATABASE": "service_desk_security_test",
    "PGUSER": "postgres",
    "PGPASSWORD": "disposable-qa-only-password",
    "SERVICE_DESK_QA_REAL_AUTH": "1",
}
if any(os.environ.get(k) != v for k, v in EXPECTED.items()):
    raise SystemExit("Refusing non-disposable GoTrue Auth QA target")
AUTH_ORIGIN = "http://127.0.0.1:3321"
USER_RE = re.compile(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\Z")
PASSWORD = "Disposable-Only-QA-Password-2026"
USERS = (
    ("browser.auth.real@infodive.test", "10000000-0000-4000-8000-000000000002", "QA User B"),
    ("browser.auth.foreign@infodive.test", "10000000-0000-4000-8000-000000000001", "QA User A"),
)
SQL = """
insert into auth.users(id) values (:'auth_user_id'::uuid);
insert into public.users(id, tenant_id, email, display_name)
values (:'auth_user_id'::uuid, :'qa_tenant_id'::uuid, :'qa_user_email', :'qa_user_name');
insert into public.roles(id,tenant_id,code,name)
values (gen_random_uuid(), :'qa_tenant_id'::uuid, 'requester', 'Requester')
on conflict (tenant_id,code) do nothing;
insert into public.memberships(tenant_id,user_id,role_id)
select :'qa_tenant_id'::uuid, :'auth_user_id'::uuid, r.id
from public.roles r
where r.tenant_id=:'qa_tenant_id'::uuid and r.code='requester';
"""


def signup(email: str) -> str:
    req = urllib.request.Request(
        AUTH_ORIGIN + "/signup",
        headers={"Content-Type": "application/json"},
        data=json.dumps({"email": email, "password": PASSWORD}).encode("utf-8"),
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        result = json.load(response)
    if not isinstance(result, dict):
        raise RuntimeError("invalid real GoTrue signup response")
    user = result.get("user")
    uid = user.get("id") if isinstance(user, dict) else None
    access = result.get("access_token")
    if not isinstance(uid, str) or not USER_RE.fullmatch(uid):
        raise RuntimeError("real GoTrue did not create a valid user")
    if not isinstance(access, str) or len(access.split(".")) != 3:
        raise RuntimeError("real GoTrue did not issue a signed password session")
    # The browser MUST acquire its own token via /token, never use this one.
    return uid


def bind_membership(uid: str,tenant: str,email: str,name: str) -> None:
    if not USER_RE.fullmatch(uid) or not USER_RE.fullmatch(tenant):
        raise RuntimeError("invalid tenant membership fixture identity")
    cmd = [
        "psql", "-X", "-w", "-v", "ON_ERROR_STOP=1",
        "-v", "auth_user_id=" + uid,
        "-v", "qa_tenant_id=" + tenant,
        "-v", "qa_user_email=" + email,
        "-v", "qa_user_name=" + name,
    ]
    proc = subprocess.run(cmd, input=SQL, text=True, capture_output=True, timeout=20)
    if proc.returncode:
        # SQL engine details can contain credentials or input; fail sanitized.
        raise RuntimeError("disposable Service Desk identity linkage failed")


def main() -> None:
    for email,tenant,name in USERS:
        uid = signup(email)
        bind_membership(uid,tenant,email,name)
    print("REAL_GOTRUE_PASSWORD_SIGNUP_AND_TENANT_FIXTURES_PASS=1")


if __name__ == "__main__":
    main()
