# Session activation and security boundary

Status: **not deployed**. The UI requests `GET /api/session` using same-origin credentials
and no-store. The transport-neutral HTTP handler in
`src/authentication/session-http.ts` delegates to
`src/authentication/server-session.ts`.

## Required production integration

1. Mount the route at the same origin as the UI. Accept only GET and never cache
   its response. Configure CSRF protection for any future mutating routes.
2. Verify the authenticated user with Supabase Auth **on the server** using the
   authenticated session's real cookie/token and provider verification. Never
   decode an unsigned client claim into an identity.
3. Resolve membership from the database using the verified `auth.users.id`.
   Require `memberships.status = 'active'`, join `roles` by both role id and
   tenant id, and join `tenants` for display name. Never trust client roles.
4. Select tenant context using a separately verified membership. For users with
   multiple active tenants, do not silently choose the first tenant: require
   an explicit, authenticated tenant selection and revalidate it server-side.
5. Map only the six supported role codes to the public session response. Deny
   inactive membership, missing tenant, invalid roles and provider failures.
6. Authorize every protected command server-side, with tenant-scoped queries
   and RLS. A successful session response is **not** permission to access any
   tenant's records.
7. Implement secure logout and session revocation, expiration handling,
   cookie attributes, CSP and end-to-end browser validation before release.

## Explicitly unfinished

Supabase Auth identity verification, membership database adapter, and a localhost HTTP
session server are implemented and were validated in Factory QA run 38955363511.
A deployed same-origin HTTP server, secure session cookie issuer, tenant-selection
endpoint, logout handler and browser E2E do not exist yet. The implemented
verification modules are **not** a live login system.

Never embed `SUPABASE_SECRET_KEY`, service-role credentials or cross-repository
tokens in browser code. No migration, preview or production deployment is implied.
