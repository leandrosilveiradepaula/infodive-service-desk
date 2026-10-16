import assert from "node:assert/strict";
import test from "node:test";

import { assertIdempotentSlaEvent, calculatePauseImpactMinutes, calculateReopenedTargets, calculateSlaTargets } from "../../src/domain/sla";
import { createContractConsumption, totalConsumedMinutes } from "../../src/domain/time-tracking";

const businessRule = {
  id: "rule-v1",
  contractId: "contract-1",
  version: 1,
  priority: "normal" as const,
  timezone: "America/Sao_Paulo",
  schedule: {
    kind: "business_hours" as const,
    weekdays: [1, 2, 3, 4, 5],
    startMinute: 9 * 60,
    endMinute: 18 * 60,
    holidayDates: ["2026-01-01"]
  },
  firstResponseMinutes: 60,
  updateMinutes: 120,
  resolutionMinutes: 240
};

test("calculates business-hour targets across a weekend in the configured timezone", () => {
  const targets = calculateSlaTargets(new Date("2026-01-02T20:30:00.000Z"), { ...businessRule, firstResponseMinutes: 120 }); // Friday 17:30 BRT: 30m Friday + 90m Monday
  assert.equal(targets.firstResponseAt.toISOString(), "2026-01-05T13:30:00.000Z"); // Monday 10:30 BRT, after crossing the weekend
});

test("skips configured holidays and supports explicit 24x7 rules", () => {
  const holidayStart = new Date("2025-12-31T20:30:00.000Z"); // 17:30 BRT
  assert.equal(calculateSlaTargets(holidayStart, businessRule).firstResponseAt.toISOString(), "2026-01-02T12:30:00.000Z");

  const aroundTheClock = { ...businessRule, schedule: { kind: "24x7" as const } };
  assert.equal(calculateSlaTargets(holidayStart, aroundTheClock).firstResponseAt.toISOString(), "2025-12-31T21:30:00.000Z");
});

test("records pause impact in SLA minutes and restarts targets on reopen", () => {
  const impact = calculatePauseImpactMinutes({
    reason: "Awaiting customer information",
    ruleVersionId: "rule-v1",
    pausedAt: new Date("2026-01-05T13:00:00.000Z"),
    resumedAt: new Date("2026-01-05T14:30:00.000Z")
  }, businessRule);
  assert.equal(impact, 90);
  assert.equal(calculateReopenedTargets(new Date("2026-01-05T13:00:00.000Z"), businessRule).firstResponseAt.toISOString(), "2026-01-05T14:00:00.000Z");
});

test("requires idempotency keys and preserves time consumption snapshots", () => {
  assert.throws(() => assertIdempotentSlaEvent({ ticketId: "ticket-1", ruleVersionId: "rule-v1", eventType: "started", idempotencyKey: "", occurredAt: new Date() }));
  const consumption = createContractConsumption({
    id: "time-1", tenantId: "tenant-1", contractId: "contract-1", ticketId: "ticket-1", authorUserId: "user-1",
    workedAt: new Date(), minutes: 30, description: "Diagnosis"
  }, new Date());
  assert.equal(totalConsumedMinutes([consumption], "contract-1"), 30);
});
