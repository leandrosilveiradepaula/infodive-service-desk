import assert from "node:assert/strict";
import test from "node:test";

import { createSignedWebhookDelivery, recordWebhookAttempt, verifyWebhookSignature } from "../../src/integrations/webhooks";

const event = { id: "event-1", tenantId: "tenant-1", type: "ticket.changed", correlationId: "request-1", payload: { ticketId: "ticket-1" }, occurredAt: new Date("2026-01-01T00:00:00.000Z"), status: "pending" as const };
const endpoint = { id: "endpoint-1", url: "https://receiver.example/hooks", signingSecret: "test-signing-secret", maxAttempts: 3 };

test("signs a deterministic webhook payload that consumers can verify", () => {
  const delivery = createSignedWebhookDelivery(event, endpoint);
  assert.ok(verifyWebhookSignature(delivery.body, delivery.headers["x-webhook-signature"], endpoint.signingSecret));
  assert.equal(verifyWebhookSignature(`${delivery.body}x`, delivery.headers["x-webhook-signature"], endpoint.signingSecret), false);
});

test("records sanitized failures and schedules bounded retries", async () => {
  const attempts: unknown[] = [];
  const store = { persistEvent: async () => {}, persistAttempt: async (attempt: unknown) => { attempts.push(attempt); } };
  const attempt = await recordWebhookAttempt(store, event, endpoint, 1, event.occurredAt, { statusCode: 503, error: new Error("destination response body must not persist") });
  assert.equal(attempt.result.summary, "HTTP 503");
  assert.equal(attempt.result.errorCode, "Error");
  assert.equal(attempt.nextAttemptAt?.toISOString(), "2026-01-01T00:01:00.000Z");
  assert.equal(attempts.length, 1);
});
