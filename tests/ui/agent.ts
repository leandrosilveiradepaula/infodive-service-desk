import assert from "node:assert/strict";
import test from "node:test";

import {
  applySavedAgentView,
  buildAgentInbox,
  buildAgentTicketDetail,
  createSavedAgentView,
  getAgentKeyboardShortcuts,
  getAgentWorkspaceLayout
} from "../../src/ui/agent";

const tickets = [
  {
    id: "INC-2",
    subject: "Email unavailable",
    status: "open" as const,
    priority: 2,
    assigneeUserId: "agent-1",
    requesterName: "Ana",
    createdAt: "2026-10-10T09:00:00.000Z",
    updatedAt: "2026-10-10T11:00:00.000Z"
  },
  {
    id: "INC-1",
    subject: "VPN access",
    status: "new" as const,
    priority: 1,
    assigneeUserId: null,
    requesterName: "Bruno",
    createdAt: "2026-10-10T08:00:00.000Z",
    updatedAt: "2026-10-10T12:00:00.000Z"
  }
];

test("builds filtered and ordered agent queues", () => {
  assert.deepEqual(
    buildAgentInbox(tickets, "agent-1", { queue: "assigned_to_me", sort: "priority", direction: "asc" }).map((ticket) => ticket.id),
    ["INC-2"]
  );
  assert.deepEqual(
    buildAgentInbox(tickets, "agent-1", { queue: "all", query: "vpn", sort: "updated_at", direction: "desc" }).map((ticket) => ticket.id),
    ["INC-1"]
  );
});

test("creates immutable saved inbox views", () => {
  const view = createSavedAgentView({
    id: "view-1",
    ownerUserId: "agent-1",
    name: "My new tickets",
    filters: { queue: "assigned_to_me", statuses: ["new"], sort: "updated_at", direction: "desc" },
    createdAt: "2026-10-10T12:00:00.000Z"
  });
  const applied = applySavedAgentView(view);

  assert.deepEqual(applied, view.filters);
  assert.notEqual(applied.statuses, view.filters.statuses);
  assert.throws(() => createSavedAgentView({ ...view, name: " " }));
});

test("does not offer restricted actions or internal notes and displays available SLA alerts", () => {
  const detail = buildAgentTicketDetail({
    ...tickets[0],
    description: "The customer cannot receive messages.",
    teamName: "Support",
    attachments: [],
    comments: [
      { id: "comment-public", authorName: "Ana", body: "Please help", visibility: "public", createdAt: "2026-10-10T09:00:00.000Z" },
      { id: "comment-internal", authorName: "Agent", body: "Checking mail logs", visibility: "internal", createdAt: "2026-10-10T10:00:00.000Z" }
    ],
    sla: { state: "at_risk", targetAt: "2026-10-10T13:00:00.000Z", metric: "resolution" }
  }, {
    canReplyPublic: true,
    canAddInternalNote: false,
    canRecordActivity: false,
    canAssign: false,
    canTransfer: false,
    canChangeStatus: false
  });

  assert.deepEqual(detail.ticket.comments.map((comment) => comment.id), ["comment-public"]);
  assert.equal(detail.actions.addInternalNote, false);
  assert.equal(detail.actions.assign, false);
  assert.deepEqual(detail.slaAlert, { state: "at_risk", targetAt: "2026-10-10T13:00:00.000Z", metric: "resolution" });
  assert.deepEqual(getAgentKeyboardShortcuts(detail.actions).map((shortcut) => shortcut.key), ["Alt+I", "Alt+D", "Alt+R"]);
});

test("selects a stacked layout for small screens", () => {
  assert.equal(getAgentWorkspaceLayout(500).mode, "stacked");
  assert.equal(getAgentWorkspaceLayout(1024).mode, "two_column");
});
