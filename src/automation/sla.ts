export type SlaAutomationState = "at_risk" | "breached" | "paused" | "met";
export type SlaAutomationAction = "notify" | "change_ticket_status" | "add_ticket_comment" | "send_external_webhook";

export interface SlaAutomationRule {
  readonly id: string;
  readonly tenantId: string;
  readonly enabled: boolean;
  readonly action: SlaAutomationAction;
  readonly riskThresholdMinutes: number;
}

export interface SlaAutomationTarget {
  readonly ticketId: string;
  readonly ruleVersionId: string;
  readonly metric: "first_response" | "update" | "resolution";
  readonly dueAt: Date;
  readonly paused: boolean;
  readonly metAt: Date | null;
}

export interface SlaAutomationEvent {
  readonly ticketId: string;
  readonly ruleVersionId: string;
  readonly metric: SlaAutomationTarget["metric"];
  readonly state: SlaAutomationState;
  readonly occurredAt: Date;
  readonly idempotencyKey: string;
}

export interface InAppSlaNotification {
  readonly ticketId: string;
  readonly state: SlaAutomationState;
  readonly eventIdempotencyKey: string;
  readonly deduplicationKey: string;
}

export interface SlaAutomationExecution {
  readonly ruleId: string;
  readonly correlationId: string;
  readonly executedAt: Date;
  readonly outcome: "skipped_disabled" | "blocked_sensitive_action" | "completed";
  readonly emittedEventCount: number;
  readonly emittedNotificationCount: number;
}

export interface SlaAutomationResult {
  readonly execution: SlaAutomationExecution;
  readonly events: readonly SlaAutomationEvent[];
  readonly notifications: readonly InAppSlaNotification[];
}

const sensitiveActions: readonly SlaAutomationAction[] = [
  "change_ticket_status",
  "add_ticket_comment",
  "send_external_webhook"
];

/** Produces a stable key for a target state, allowing retried jobs to be safely replayed. */
export function slaAutomationIdempotencyKey(target: SlaAutomationTarget, state: SlaAutomationState): string {
  return [
    "sla-automation",
    target.ticketId,
    target.ruleVersionId,
    target.metric,
    state,
    target.dueAt.toISOString()
  ].join(":");
}

/** Sensitive ticket-changing or external actions always require an explicit human operation. */
export function isSensitiveSlaAutomationAction(action: SlaAutomationAction): boolean {
  return sensitiveActions.includes(action);
}

/**
 * Evaluates one SLA target and emits only unseen domain-derived alerts. Callers persist
 * returned keys atomically with their corresponding records before acknowledging a job.
 */
export function runSlaAutomation(
  rule: SlaAutomationRule,
  target: SlaAutomationTarget,
  now: Date,
  correlationId: string,
  existingEventKeys: ReadonlySet<string>,
  existingNotificationKeys: ReadonlySet<string>
): SlaAutomationResult {
  assertValidInput(rule, target, now, correlationId);

  if (!rule.enabled) {
    return emptyResult(rule, correlationId, now, "skipped_disabled");
  }
  if (isSensitiveSlaAutomationAction(rule.action)) {
    return emptyResult(rule, correlationId, now, "blocked_sensitive_action");
  }

  const state = determineState(rule, target, now);
  if (state === null) {
    return emptyResult(rule, correlationId, now, "completed");
  }

  const idempotencyKey = slaAutomationIdempotencyKey(target, state);
  const events: SlaAutomationEvent[] = existingEventKeys.has(idempotencyKey)
    ? []
    : [{
      ticketId: target.ticketId,
      ruleVersionId: target.ruleVersionId,
      metric: target.metric,
      state,
      occurredAt: new Date(now),
      idempotencyKey
    }];

  const deduplicationKey = `in-app:${idempotencyKey}`;
  const notifications: InAppSlaNotification[] = events.length === 0 || existingNotificationKeys.has(deduplicationKey)
    ? []
    : [{
      ticketId: target.ticketId,
      state,
      eventIdempotencyKey: idempotencyKey,
      deduplicationKey
    }];

  return {
    execution: {
      ruleId: rule.id,
      correlationId,
      executedAt: new Date(now),
      outcome: "completed",
      emittedEventCount: events.length,
      emittedNotificationCount: notifications.length
    },
    events,
    notifications
  };
}

function determineState(
  rule: SlaAutomationRule,
  target: SlaAutomationTarget,
  now: Date
): SlaAutomationState | null {
  if (target.paused) {
    return "paused";
  }
  if (target.metAt !== null) {
    return "met";
  }
  if (now >= target.dueAt) {
    return "breached";
  }
  const riskAt = target.dueAt.getTime() - rule.riskThresholdMinutes * 60_000;
  return now.getTime() >= riskAt ? "at_risk" : null;
}

function emptyResult(
  rule: SlaAutomationRule,
  correlationId: string,
  now: Date,
  outcome: SlaAutomationExecution["outcome"]
): SlaAutomationResult {
  return {
    execution: {
      ruleId: rule.id,
      correlationId,
      executedAt: new Date(now),
      outcome,
      emittedEventCount: 0,
      emittedNotificationCount: 0
    },
    events: [],
    notifications: []
  };
}

function assertValidInput(
  rule: SlaAutomationRule,
  target: SlaAutomationTarget,
  now: Date,
  correlationId: string
): void {
  if (rule.id.trim().length === 0 || rule.tenantId.trim().length === 0 || !Number.isInteger(rule.riskThresholdMinutes) || rule.riskThresholdMinutes < 0) {
    throw new Error("SLA automation rules require identifiers, tenant scope, and a non-negative risk threshold.");
  }
  if (target.ticketId.trim().length === 0 || target.ruleVersionId.trim().length === 0 || Number.isNaN(target.dueAt.getTime())) {
    throw new Error("SLA automation targets require a ticket, SLA rule version, and valid deadline.");
  }
  if ((target.metAt !== null && Number.isNaN(target.metAt.getTime())) || Number.isNaN(now.getTime()) || correlationId.trim().length === 0) {
    throw new Error("SLA automation requires valid timestamps and a correlation identifier.");
  }
}
