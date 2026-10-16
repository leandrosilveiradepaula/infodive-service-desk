import assert from "node:assert/strict";
import test from "node:test";

import { createPublicApi, InMemoryIdempotencyExecutor } from "../../src/interface/api/public";

const authenticated = {
  authenticateService: async () => ({ kind: "service" as const, clientId: "integration-a", tenantId: "tenant-a", scopes: ["tickets:write"] }),
  authenticateUser: async () => null
};

test("public API rejects insufficient service scope and invalid payloads", async () => {
  const api = createPublicApi({
    authenticator: { ...authenticated, authenticateService: async () => ({ kind: "service", clientId: "limited", tenantId: "tenant-a", scopes: [] }) },
    idempotency: new InMemoryIdempotencyExecutor(),
    tickets: { createTicket: async () => { throw new Error("must not run"); } }
  });
  assert.equal((await api.createTicket({ body: { title: "Valid title" }, idempotencyKey: "one" })).status, 403);

  const validScopeApi = createPublicApi({ authenticator: authenticated, idempotency: new InMemoryIdempotencyExecutor(), tickets: { createTicket: async () => { throw new Error("must not run"); } } });
  assert.equal((await validScopeApi.createTicket({ body: { title: "x" }, idempotencyKey: "one" })).status, 422);
});

test("public API returns the original result for an idempotent command and rejects key reuse with another payload", async () => {
  let calls = 0;
  const api = createPublicApi({
    authenticator: authenticated,
    idempotency: new InMemoryIdempotencyExecutor(),
    tickets: { createTicket: async (input) => ({ id: `ticket-${++calls}`, tenantId: input.tenantId, title: input.title }) }
  });
  const first = await api.createTicket({ body: { title: "Printer is offline" }, idempotencyKey: "operation-1" });
  const repeated = await api.createTicket({ body: { title: "Printer is offline" }, idempotencyKey: "operation-1" });
  const conflict = await api.createTicket({ body: { title: "VPN is offline" }, idempotencyKey: "operation-1" });
  assert.equal(first.status, 201);
  assert.deepEqual(repeated.body, first.body);
  assert.equal(calls, 1);
  assert.equal(conflict.status, 409);
});
