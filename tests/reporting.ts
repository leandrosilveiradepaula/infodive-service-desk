import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateDashboardMetrics,
  exportReportCsv,
  queryReportingTickets,
  type ReportingTicket
} from "../src/domain/reporting";

const access = {
  authorizedTenantIds: ["tenant-a"],
  canViewReports: true,
  canExportReports: true
};

const filters = {
  tenantId: "tenant-a",
  from: new Date("2026-01-01T00:00:00.000Z"),
  to: new Date("2026-01-31T23:59:59.999Z")
};

const tickets: readonly ReportingTicket[] = [
  {
    id: "a-resolved",
    tenantId: "tenant-a",
    createdAt: new Date("2026-01-02T10:00:00.000Z"),
    firstRespondedAt: new Date("2026-01-02T10:30:00.000Z"),
    resolvedAt: new Date("2026-01-02T12:00:00.000Z"),
    status: "resolved",
    clientId: "client-a",
    teamId: "team-1",
    technicianId: "tech-1",
    categoryId: "category-1",
    serviceId: "service-1",
    priority: "high",
    contractId: "contract-a",
    slaResolutionDueAt: new Date("2026-01-02T13:00:00.000Z")
  },
  {
    id: "a-backlog",
    tenantId: "tenant-a",
    createdAt: new Date("2026-01-03T10:00:00.000Z"),
    firstRespondedAt: null,
    resolvedAt: null,
    status: "in_progress",
    clientId: "client-a",
    teamId: "team-1",
    technicianId: "tech-2",
    categoryId: "category-2",
    serviceId: "service-1",
    priority: "normal",
    contractId: null,
    slaResolutionDueAt: null
  },
  {
    id: "other-tenant",
    tenantId: "tenant-b",
    createdAt: new Date("2026-01-04T10:00:00.000Z"),
    firstRespondedAt: new Date("2026-01-04T10:05:00.000Z"),
    resolvedAt: new Date("2026-01-04T11:00:00.000Z"),
    status: "resolved",
    clientId: "client-b",
    teamId: "team-2",
    technicianId: "tech-b",
    categoryId: "category-b",
    serviceId: "service-b",
    priority: "urgent",
    contractId: "contract-b",
    slaResolutionDueAt: new Date("2026-01-04T10:30:00.000Z")
  }
];

test("dashboard aggregation scopes records to the authorized tenant before metrics", () => {
  const metrics = calculateDashboardMetrics(tickets, [
    {
      tenantId: "tenant-a",
      contractId: "contract-a",
      recordedAt: new Date("2026-01-05T10:00:00.000Z"),
      consumedMinutes: 90,
      includedMinutes: 300
    },
    {
      tenantId: "tenant-b",
      contractId: "contract-b",
      recordedAt: new Date("2026-01-05T10:00:00.000Z"),
      consumedMinutes: 999,
      includedMinutes: 999
    }
  ], filters, access);

  assert.equal(metrics.volume, 2);
  assert.equal(metrics.backlog, 1);
  assert.equal(metrics.resolutions, 1);
  assert.equal(metrics.averageFirstResponseMinutes, 30);
  assert.equal(metrics.averageResolutionMinutes, 120);
  assert.deepEqual(metrics.slaCompliance, { met: 1, evaluated: 1, percentage: 100 });
  assert.deepEqual(metrics.contractConsumption, { consumedMinutes: 90, includedMinutes: 300, remainingMinutes: 210 });
});

test("filters and exports cannot reveal records from another tenant and exports are audited", () => {
  const filtered = queryReportingTickets(tickets, { ...filters, technicianId: "tech-2" }, access);
  assert.deepEqual(filtered.map((ticket) => ticket.id), ["a-backlog"]);

  const audits: unknown[] = [];
  const exported = exportReportCsv(
    tickets,
    filters,
    access,
    { legalApproved: true, allowedFields: ["id", "clientId", "priority"], maximumRows: 10 },
    ["id", "clientId", "priority"],
    "Monthly operational review",
    new Date("2026-02-01T00:00:00.000Z"),
    (record) => audits.push(record)
  );

  assert.equal(exported.rowCount, 2);
  assert.match(exported.csv, /a-resolved/);
  assert.doesNotMatch(exported.csv, /other-tenant/);
  assert.deepEqual(audits, [{
    action: "report.exported",
    tenantId: "tenant-a",
    exportedAt: new Date("2026-02-01T00:00:00.000Z"),
    rowCount: 2,
    fields: ["id", "clientId", "priority"],
    justification: "Monthly operational review"
  }]);
});

test("non-applicable metrics are explicit and unapproved exports are rejected", () => {
  const metrics = calculateDashboardMetrics([], [], filters, access);
  assert.equal(metrics.averageFirstResponseMinutes, null);
  assert.equal(metrics.averageResolutionMinutes, null);
  assert.equal(metrics.slaCompliance.percentage, null);
  assert.equal(metrics.contractConsumption, null);

  assert.throws(() => exportReportCsv(
    tickets,
    filters,
    access,
    { legalApproved: false, allowedFields: ["id"], maximumRows: 10 },
    ["id"],
    "Review",
    new Date(),
    () => undefined
  ));
});
