import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTicketRelationship,
  assertTicketTransition,
  canReadTicketComment,
  canTransitionTicket,
  type TicketRelationshipType
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
});

test("rejects invalid ticket relationship types received at runtime", () => {
  const runtimeRelationshipType: string = "not_a_relationship";

  assert.throws(
    () =>
      assertTicketRelationship(
        { id: "ticket-1", tenantId: "tenant-a" },
        { id: "ticket-2", tenantId: "tenant-a" },
        runtimeRelationshipType as TicketRelationshipType
      ),
    /Invalid ticket relationship type\./
  );
});

test("accepts every valid ticket relationship type for distinct tenant tickets", () => {
  const relationshipTypes: readonly TicketRelationshipType[] = [
    "relates_to",
    "blocks",
    "blocked_by",
    "duplicates",
    "duplicated_by",
    "parent_of",
    "child_of"
  ];

  for (const relationshipType of relationshipTypes) {
    assert.doesNotThrow(() =>
      assertTicketRelationship(
        { id: "ticket-1", tenantId: "tenant-a" },
        { id: "ticket-2", tenantId: "tenant-a" },
        relationshipType
      )
    );
  }
});
