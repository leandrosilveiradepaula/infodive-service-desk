"""Persist a ticket through real PostgREST under signed user JWT + PostgreSQL RLS.

All data/identities and the signing key are disposable CI fixtures. This is
NOT Supabase Auth and must never be described as a production login test.
"""
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:3319/tickets"
TENANT_A = "10000000-0000-4000-8000-000000000001"
TENANT_B = "10000000-0000-4000-8000-000000000002"
USER_A = "10000000-0000-4000-8000-000000000011"
USER_B = "10000000-0000-4000-8000-000000000022"
SECRET = os.environ["SERVICE_DESK_QA_JWT_SECRET"].encode()
SELECT = "id,tenant_id,protocol,subject,description,priority,status,created_at,updated_at"


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def sign(sub, role="authenticated"):
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    claims = b64(json.dumps({
        "sub": sub, "role": role, "aud": "authenticated",
        "iat": int(time.time()), "exp": int(time.time()) + 600,
    }, separators=(",", ":")).encode())
    content = (header + "." + claims).encode()
    signature = b64(hmac.new(SECRET, content, hashlib.sha256).digest())
    return content.decode() + "." + signature


def execute(token, method="GET", fields=None, payload=None):
    query = "?" + urllib.parse.urlencode(fields) if fields else ""
    body = json.dumps(payload).encode() if payload is not None else None
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if payload is not None:
        headers["Content-Type"] = "application/json"
        headers["Prefer"] = "return=representation"
    request = urllib.request.Request(BASE + query, headers=headers, data=body, method=method)
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as err:
        raw = err.read().decode()
        return err.code, json.loads(raw) if raw else {}


def main():
    user_b = sign(USER_B)
    probe_url = "http://127.0.0.1:3319/rpc/qa_claim_probe"
    request = urllib.request.Request(probe_url, headers={"Authorization": "Bearer " + user_b})
    with urllib.request.urlopen(request, timeout=8) as response:
        probe = json.loads(response.read())
    assert probe["uid"] == USER_B and probe["role"] == "authenticated" and probe["member"] is True, probe
    print("POSTGREST_JWT_IDENTITY_PROBE_PASS=1")
    where_b = {"select": SELECT, "tenant_id": "eq." + TENANT_B,
               "order": "created_at.desc", "limit": "50"}
    subject = "QA real PostgREST ticket persistence"
    code, rows = execute(user_b, "POST", {
        "select": SELECT, "tenant_id": "eq." + TENANT_B
    }, {
        "tenant_id": TENANT_B, "requester_user_id": USER_B,
        "subject": subject, "description": "Recorded in disposable PostgreSQL",
        "priority": "normal",
    })
    assert code == 201, f"JWT create failed: HTTP {code}: {rows}"
    assert isinstance(rows, list) and len(rows) == 1, rows
    created = rows[0]
    assert created["tenant_id"] == TENANT_B, created
    assert created["subject"] == subject, created
    assert created["protocol"], "Trigger must assign a nonempty protocol"
    assert created["status"] == "new", created
    ticket_id = created["id"]

    code, listed = execute(user_b, fields=where_b)
    assert code == 200, f"JWT list failed: HTTP {code}: {listed}"
    assert any(x["id"] == ticket_id for x in listed), listed
    code, detail = execute(user_b, fields={
        "select": SELECT, "tenant_id": "eq." + TENANT_B, "id": "eq." + ticket_id
    })
    assert code == 200 and len(detail) == 1 and detail[0]["id"] == ticket_id, detail

    # Another user with an active B membership cannot read a B ticket owned
    # by this user unless their own role has a ticket-read permission.
    code, other = execute(sign(USER_A), fields={
        "select": SELECT, "tenant_id": "eq." + TENANT_B, "id": "eq." + ticket_id
    })
    assert code == 200 and other == [], f"Ticket leaked to non-owner: {code}: {other}"

    code, anonymous = execute(None, fields=where_b)
    assert code in (401, 403), f"Anonymous query unexpectedly allowed: {code}: {anonymous}"
    code, spoofed = execute(user_b, "POST", {"select": SELECT}, {
        "tenant_id": TENANT_A, "requester_user_id": USER_A,
        "subject": "Spoofed tenant", "description": None, "priority": "normal",
    })
    assert code in (400, 401, 403), f"JWT spoof insert accepted: {code}: {spoofed}"
    print("POSTGREST_JWT_TICKET_CREATE_LIST_RLS_PASS=1")
    print("POSTGREST_JWT_CROSS_TENANT_DENY_PASS=1")


if __name__ == "__main__":
    main()
