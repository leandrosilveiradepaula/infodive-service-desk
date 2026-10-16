import assert from "node:assert/strict";
import test from "node:test";

import {
  CustomerPortalController,
  type CustomerPortalApi,
  type CustomerTicket,
  toCustomerTicketDetail,
  toCustomerTicketSummary,
  validateCustomerTicketForm
} from "../../src/ui/customer";

const ticket: CustomerTicket = {
  id: "ticket-1",
  protocol: "T-000001",
  companyId: "company-a",
  requesterUserId: "requester-a",
  requesterName: "Ana Cliente",
  subject: "Não consigo acessar o sistema",
  description: "A tela informa que meu acesso expirou.",
  status: "waiting_customer",
  createdAt: "2026-10-15T10:00:00Z",
  updatedAt: "2026-10-15T11:00:00Z",
  comments: [
    { id: "public-comment", authorName: "Suporte", body: "Estamos analisando.", createdAt: "2026-10-15T10:30:00Z", visibility: "public" },
    { id: "internal-comment", authorName: "Suporte", body: "Credencial será redefinida.", createdAt: "2026-10-15T10:31:00Z", visibility: "internal" }
  ],
  history: [
    { id: "public-event", description: "Chamado aberto", occurredAt: "2026-10-15T10:00:00Z", visibility: "public" },
    { id: "internal-event", description: "Encaminhado para time interno", occurredAt: "2026-10-15T10:10:00Z", visibility: "internal" }
  ],
  attachments: [
    { id: "public-file", name: "erro.png", downloadUrl: "/files/public-file", visibility: "public" },
    { id: "internal-file", name: "diagnostico.pdf", downloadUrl: "/files/internal-file", visibility: "internal" }
  ]
};

const requester = { userId: "requester-a", companyId: "company-a", role: "requester" as const };

test("customer detail never exposes internal notes, history, or attachments", () => {
  const detail = toCustomerTicketDetail(requester, ticket);

  assert.ok(detail);
  assert.deepEqual(detail.comments.map((comment) => comment.id), ["public-comment"]);
  assert.deepEqual(detail.history.map((entry) => entry.id), ["public-event"]);
  assert.deepEqual(detail.attachments.map((attachment) => attachment.id), ["public-file"]);
});

test("requesters cannot see or respond to another requester's ticket", async () => {
  const otherRequesterTicket = { ...ticket, requesterUserId: "requester-b" };
  assert.equal(toCustomerTicketSummary(requester, otherRequesterTicket), null);

  const api: CustomerPortalApi = {
    async listTickets() { return [otherRequesterTicket]; },
    async getTicket() { return otherRequesterTicket; },
    async createTicket() { return ticket; },
    async addPublicComment() { throw new Error("must not be called"); }
  };
  const portal = new CustomerPortalController(requester, api);

  assert.deepEqual(await portal.list(), []);
  await assert.rejects(() => portal.reply(otherRequesterTicket.id, "Posso ajudar?"), /não tem permissão/);
});

test("managers have a distinct company-wide list view without internal content", () => {
  const summary = toCustomerTicketSummary({ userId: "manager-a", companyId: "company-a", role: "manager" }, ticket);
  assert.equal(summary?.requesterName, "Ana Cliente");

  const detail = toCustomerTicketDetail({ userId: "manager-a", companyId: "company-a", role: "manager" }, ticket);
  assert.equal(detail?.comments.some((comment) => comment.visibility === "internal"), false);
});

test("opening form provides understandable validation for required fields and unsafe evidence", () => {
  const errors = validateCustomerTicketForm({
    subject: "oi",
    description: "",
    attachments: [{ name: "installer.exe", type: "application/octet-stream", size: 1024 }]
  });

  assert.match(errors.subject ?? "", /3 e 240/);
  assert.match(errors.description ?? "", /Descreva/);
  assert.match(errors.attachments ?? "", /executáveis não são permitidos/);
});
