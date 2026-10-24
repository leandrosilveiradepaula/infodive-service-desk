"""Live PostgREST embedding query against disposable PostgreSQL, NOT real Supabase Auth."""
import json
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import urlopen

BASE = "http://127.0.0.1:3318"
USER_A = "10000000-0000-4000-8000-000000000011"
TENANT_A = "10000000-0000-4000-8000-000000000001"
TENANT_B = "10000000-0000-4000-8000-000000000002"


def get(path: str, **parameters: str):
    url = f"{BASE}/{path}?{urlencode(parameters)}"
    try:
        with urlopen(url, timeout=8) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.loads(error.read().decode())


def main() -> None:
    code, members = get(
        "memberships",
        select="user_id,tenant_id,status,"
        "roles!memberships_role_id_fkey!inner(code,tenant_id),tenants!inner(name)",
        user_id=f"eq.{USER_A}", status="eq.active",
    )
    assert code == 200, f"membership request failed: HTTP {code} {members}"
    assert isinstance(members, list) and len(members) == 1, members
    row = members[0]
    assert row["user_id"] == USER_A
    assert row["tenant_id"] == TENANT_B, "Suspended tenant A must not appear"
    assert row["status"] == "active"
    assert row["roles"] == {"code": "qa_b", "tenant_id": TENANT_B}
    assert row["tenants"] == {"name": "QA Tenant B"}

    code, users = get("users", select="id,tenant_id,display_name", id=f"eq.{USER_A}")
    assert code == 200, f"profile lookup failed: HTTP {code} {users}"
    assert users == [{"id": USER_A, "tenant_id": TENANT_A, "display_name": "QA User A"}], users

    code, payload = get("memberships", select="roles(code)", user_id=f"eq.{USER_A}")
    assert code == 300, f"Expected ambiguous FK error, got {code}: {payload}"
    assert payload.get("code") == "PGRST201", payload
    print("POSTGREST_MEMBERSHIP_CONTRACT_PASS=1")


if __name__ == "__main__":
    main()
