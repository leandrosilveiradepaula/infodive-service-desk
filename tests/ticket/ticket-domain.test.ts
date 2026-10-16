import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTicketRelationship,
  assertTicketTransition,
  canReadTicketComment,
  canTransitionTicket
} from "../../src/domain/ticket";

test("uses the default ticket lifecycle transitions", () => {
  assert.equal(canTransitionTicket("new", "open"), true);
  assert.equal(canTransitionTicket("resolved", "reopened"), true);
  assert.equal(canTransitionTicket("closed", "open"), false);
  assert.throws(() => assertTicketTransition("closed", "open"));
});

test("configured transition rules override the default lifecycle", () => {
  const rules = [{ from: "new" as const, to: "closed" as const, enabled: true }];

  assert.equal(canTransitionTicket("new", "closed", rules), true);
  assert.equal(canTransitionTicket("new", "open", rules), false);
});

test("keeps internal comments restricted to ticket managers", () => {
  const internalComment = { authorUserId: "agent-1", visibility: "internal" as const };
  const publicComment = { authorUserId: "agent-1", visibility: "public" as const };

  assert.equal(
    canReadTicketComment(internalComment, {
      userId: "requester-1",
      canReadTicket: true,
      canManageTicket: false
    }),
    false
  );
  assert.equal(
    canReadTicketComment(publicComment, {
      userId: "requester-1",
      canReadTicket: true,
      canManageTicket: false
    }),
    true
  );
  assert.equal(
    canReadTicketComment(internalComment, {
      userId: "agent-2",
      canReadTicket: true,
      canManageTicket: true
    }),
    true
  );
});

test("rejects self and cross-tenant ticket relationships", () => {
  assert.throws(() =>
    assertTicketRelationship(
      { id: "ticket-1", tenantId: "tenant-a" },
      { id: "ticket-1", tenantId: "tenant-a" },
      "relates_to"
    )
  );
  assert.throws(() =>
    assertTicketRelationship(
      { id: "ticket-1", tenantId: "tenant-a" },
      { id: "ticket-2", tenantId: "tenant-b" },
      "relates_to"
    )
  );
  assert.doesNotThrow(() =>
    assertTicketRelationship(
      { id: "ticket-1", tenantId: "tenant-a" },
      { id: "ticket-2", tenantId: "tenant-a" },
      "blocks"
    )
  );
});
