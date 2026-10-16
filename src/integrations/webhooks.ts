import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookEventStatus = "pending" | "delivered" | "retry_scheduled" | "failed";

export interface WebhookEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  readonly correlationId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly status: WebhookEventStatus;
}

export interface WebhookAttempt {
  readonly id: string;
  readonly eventId: string;
  readonly attemptNumber: number;
  readonly status: "delivered" | "failed";
  readonly attemptedAt: Date;
  readonly nextAttemptAt: Date | null;
  readonly result: WebhookDeliveryResult;
}

export interface WebhookDeliveryResult {
  readonly statusCode: number | null;
  readonly errorCode: string | null;
  readonly summary: string;
}

export interface WebhookEndpoint {
  readonly id: string;
  readonly url: string;
  /** Loaded from protected integration configuration; never persist or return it in delivery records. */
  readonly signingSecret: string;
  readonly maxAttempts: number;
}

export interface SignedWebhookDelivery {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface WebhookEventStore {
  /** This write belongs in the same transaction/outbox as the business event that produced it. */
  persistEvent(event: WebhookEvent): Promise<void>;
  persistAttempt(attempt: WebhookAttempt): Promise<void>;
}

/** Persists an event for asynchronous delivery. Callers need not wait for a destination. */
export async function enqueueWebhookEvent(store: WebhookEventStore, event: WebhookEvent): Promise<void> {
  assertValidEvent(event);
  await store.persistEvent(event);
}

/** Creates a deterministic payload and an HMAC-SHA256 signature for a single endpoint delivery. */
export function createSignedWebhookDelivery(event: WebhookEvent, endpoint: WebhookEndpoint): SignedWebhookDelivery {
  assertValidEvent(event);
  assertValidEndpoint(endpoint);
  const body = canonicalJson({ id: event.id, type: event.type, tenantId: event.tenantId, correlationId: event.correlationId, occurredAt: event.occurredAt.toISOString(), data: event.payload });
  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-webhook-id": event.id,
      "x-webhook-timestamp": event.occurredAt.toISOString(),
      "x-webhook-signature": signWebhookPayload(body, endpoint.signingSecret)
    }
  };
}

export function signWebhookPayload(body: string, secret: string): string {
  if (secret.length === 0) throw new Error("A webhook signing secret is required.");
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

/** Constant-time signature verification for webhook consumers. */
export function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signWebhookPayload(body, secret), "utf8");
  const received = Buffer.from(signature, "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Removes response bodies, headers, and stack traces from persisted delivery results. */
export function sanitizeWebhookResult(result: { readonly statusCode?: number; readonly error?: unknown }): WebhookDeliveryResult {
  const statusCode = typeof result.statusCode === "number" && Number.isInteger(result.statusCode) ? result.statusCode : null;
  const errorCode = result.error instanceof Error ? result.error.name.slice(0, 80) : result.error === undefined ? null : "delivery_error";
  const summary = statusCode !== null ? `HTTP ${statusCode}` : errorCode === null ? "Completed" : "Delivery failed";
  return { statusCode, errorCode, summary };
}

/** Exponential backoff capped at one hour prevents an unavailable destination from being hammered. */
export function nextWebhookAttemptAt(attemptNumber: number, now: Date, maxAttempts: number): Date | null {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || !Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("Webhook attempt counts must be positive integers.");
  if (attemptNumber >= maxAttempts) return null;
  return new Date(now.getTime() + Math.min(60 * 60_000, 60_000 * 2 ** (attemptNumber - 1)));
}

export async function recordWebhookAttempt(
  store: WebhookEventStore,
  event: WebhookEvent,
  endpoint: WebhookEndpoint,
  attemptNumber: number,
  attemptedAt: Date,
  outcome: { readonly statusCode?: number; readonly error?: unknown }
): Promise<WebhookAttempt> {
  const result = sanitizeWebhookResult(outcome);
  const delivered = result.statusCode !== null && result.statusCode >= 200 && result.statusCode < 300;
  const attempt: WebhookAttempt = {
    id: `${event.id}:${endpoint.id}:${attemptNumber}`,
    eventId: event.id,
    attemptNumber,
    status: delivered ? "delivered" : "failed",
    attemptedAt: new Date(attemptedAt),
    nextAttemptAt: delivered ? null : nextWebhookAttemptAt(attemptNumber, attemptedAt, endpoint.maxAttempts),
    result
  };
  await store.persistAttempt(attempt);
  return attempt;
}

function assertValidEvent(event: WebhookEvent): void {
  if ([event.id, event.tenantId, event.type, event.correlationId].some((value) => value.trim().length === 0) || Number.isNaN(event.occurredAt.getTime())) {
    throw new Error("Webhook events require id, tenant, type, correlation id, and occurrence time.");
  }
}

function assertValidEndpoint(endpoint: WebhookEndpoint): void {
  if (endpoint.id.trim().length === 0 || endpoint.signingSecret.length === 0 || !Number.isInteger(endpoint.maxAttempts) || endpoint.maxAttempts < 1) throw new Error("Webhook endpoints require id, signing secret, and positive max attempts.");
  try { new URL(endpoint.url); } catch { throw new Error("Webhook endpoints require a valid URL."); }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
