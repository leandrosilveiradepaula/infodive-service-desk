# Service Desk session activation (not yet live)

The browser session contract is intentionally fail-closed. It fetches GET /api/session
with same-origin credentials and no-store; network errors, non-200 HTTP status,
malformed payloads and unauthenticated responses all resolve to no profile.

**This commit does not implement or expose an authentication endpoint.**
Before wiring this contract to the UI, implement a same-origin server endpoint
that validates a real Supabase Auth session server-side, resolves active membership,
tenant and roles from privileged server-side queries, and returns only public profile
fields. Enforce RLS and authorization again on every protected server operation.
Never accept a browser-submitted userId, tenantId or role as authentication proof.
Never expose Supabase service-role credentials to the browser.

Release gates: verify authenticated browser navigation, logout, expiration,
cross-tenant rejection, CSP/cookies, preview evidence and explicit human release.
