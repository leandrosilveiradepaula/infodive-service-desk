export type SlaPriority = "low" | "normal" | "high" | "urgent";
export type SlaMetric = "first_response" | "update" | "resolution";
export type SlaEventType = "started" | "paused" | "resumed" | "breached" | "met" | "reopened";

export interface SlaBusinessHours {
  readonly kind: "business_hours";
  readonly weekdays: readonly number[];
  readonly startMinute: number;
  readonly endMinute: number;
  readonly holidayDates: readonly string[];
}

export interface SlaTwentyFourSeven {
  readonly kind: "24x7";
}

export type SlaSchedule = SlaBusinessHours | SlaTwentyFourSeven;

export interface SlaRuleVersion {
  readonly id: string;
  readonly contractId: string;
  readonly version: number;
  readonly priority: SlaPriority;
  readonly timezone: string;
  readonly schedule: SlaSchedule;
  readonly firstResponseMinutes: number;
  readonly updateMinutes: number;
  readonly resolutionMinutes: number;
}

export interface SlaTargets {
  readonly firstResponseAt: Date;
  readonly updateAt: Date;
  readonly resolutionAt: Date;
}

export interface SlaPause {
  readonly reason: string;
  readonly ruleVersionId: string;
  readonly pausedAt: Date;
  readonly resumedAt: Date;
}

export interface SlaEvent {
  readonly ticketId: string;
  readonly ruleVersionId: string;
  readonly eventType: SlaEventType;
  readonly idempotencyKey: string;
  readonly occurredAt: Date;
}

interface LocalDateTime {
  readonly date: string;
  readonly weekday: number;
  readonly minuteOfDay: number;
}

function localDateTime(at: Date, timezone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(at);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  const weekdayName = value("weekday");
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  if (year === undefined || month === undefined || day === undefined || weekdayName === undefined || weekdays[weekdayName] === undefined) {
    throw new Error("Unable to resolve SLA calendar time.");
  }
  return { date: `${year}-${month}-${day}`, weekday: weekdays[weekdayName], minuteOfDay: hour * 60 + minute };
}

/** Validates the persisted policy version before it is used to calculate targets. */
export function assertValidSlaRule(rule: SlaRuleVersion): void {
  if (rule.id.trim().length === 0 || rule.contractId.trim().length === 0 || !Number.isInteger(rule.version) || rule.version < 1) {
    throw new Error("An SLA rule must have an identifier, contract, and positive version.");
  }
  if (rule.timezone.trim().length === 0) {
    throw new Error("An SLA timezone is required.");
  }
  for (const minutes of [rule.firstResponseMinutes, rule.updateMinutes, rule.resolutionMinutes]) {
    if (!Number.isInteger(minutes) || minutes < 0) {
      throw new Error("SLA targets must be non-negative whole minutes.");
    }
  }
  if (rule.schedule.kind === "business_hours") {
    if (rule.schedule.weekdays.length === 0 || rule.schedule.startMinute < 0 || rule.schedule.endMinute > 1440 || rule.schedule.startMinute >= rule.schedule.endMinute) {
      throw new Error("Business-hour schedules require valid days and opening hours.");
    }
  }
}

/** Returns whether an instant consumes SLA time according to the selected calendar. */
export function isSlaWorkingTime(at: Date, rule: SlaRuleVersion): boolean {
  assertValidSlaRule(rule);
  if (rule.schedule.kind === "24x7") {
    return true;
  }
  const local = localDateTime(at, rule.timezone);
  return (
    rule.schedule.weekdays.includes(local.weekday) &&
    !rule.schedule.holidayDates.includes(local.date) &&
    local.minuteOfDay >= rule.schedule.startMinute &&
    local.minuteOfDay < rule.schedule.endMinute
  );
}

/** Adds SLA minutes, counting only calendar minutes covered by the persisted rule version. */
export function addSlaMinutes(startAt: Date, minutes: number, rule: SlaRuleVersion): Date {
  assertValidSlaRule(rule);
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new Error("SLA minutes must be a non-negative whole number.");
  }
  if (minutes === 0) {
    return new Date(startAt);
  }

  let cursor = new Date(startAt);
  let remaining = minutes;
  while (remaining > 0) {
    if (isSlaWorkingTime(cursor, rule)) {
      remaining -= 1;
    }
    cursor = new Date(cursor.getTime() + 60_000);
  }
  return cursor;
}

/** Calculates all ticket targets from one immutable SLA rule version. */
export function calculateSlaTargets(createdAt: Date, rule: SlaRuleVersion): SlaTargets {
  return {
    firstResponseAt: addSlaMinutes(createdAt, rule.firstResponseMinutes, rule),
    updateAt: addSlaMinutes(createdAt, rule.updateMinutes, rule),
    resolutionAt: addSlaMinutes(createdAt, rule.resolutionMinutes, rule)
  };
}

/** Counts the deadline impact of a recorded pause without rounding partial minutes upward. */
export function calculatePauseImpactMinutes(pause: SlaPause, rule: SlaRuleVersion): number {
  if (pause.reason.trim().length === 0 || pause.ruleVersionId !== rule.id || pause.resumedAt < pause.pausedAt) {
    throw new Error("An SLA pause requires a reason, matching rule version, and ordered timestamps.");
  }
  let cursor = new Date(pause.pausedAt);
  let impact = 0;
  while (cursor < pause.resumedAt) {
    if (isSlaWorkingTime(cursor, rule)) {
      impact += 1;
    }
    cursor = new Date(cursor.getTime() + 60_000);
  }
  return impact;
}

/** Extends a target by only the SLA time consumed while the ticket was paused. */
export function resumeSlaDeadline(deadline: Date, pause: SlaPause, rule: SlaRuleVersion): Date {
  return addSlaMinutes(deadline, calculatePauseImpactMinutes(pause, rule), rule);
}

/** Reopening starts a fresh target from the reopen event under the persisted rule version. */
export function calculateReopenedTargets(reopenedAt: Date, rule: SlaRuleVersion): SlaTargets {
  return calculateSlaTargets(reopenedAt, rule);
}

/** SLA event keys are mandatory so job retries cannot create duplicate history. */
export function assertIdempotentSlaEvent(event: SlaEvent): void {
  if (event.ticketId.trim().length === 0 || event.ruleVersionId.trim().length === 0 || event.idempotencyKey.trim().length === 0 || Number.isNaN(event.occurredAt.getTime())) {
    throw new Error("SLA events require ticket, rule version, idempotency key, and timestamp.");
  }
}
