export type ReportingPriority = "low" | "normal" | "high" | "urgent";
export type ExportField = "id" | "createdAt" | "resolvedAt" | "status" | "clientId" | "teamId" | "technicianId" | "categoryId" | "serviceId" | "priority" | "contractId";

export interface ReportingTicket {
  readonly id: string;
  readonly tenantId: string;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
  readonly firstRespondedAt: Date | null;
  readonly status: string;
  readonly clientId: string | null;
  readonly teamId: string | null;
  readonly technicianId: string | null;
  readonly categoryId: string | null;
  readonly serviceId: string | null;
  readonly priority: ReportingPriority;
  readonly contractId: string | null;
  readonly slaResolutionDueAt: Date | null;
}

export interface ContractConsumptionMetric {
  readonly tenantId: string;
  readonly contractId: string;
  readonly recordedAt: Date;
  readonly consumedMinutes: number;
  readonly includedMinutes: number | null;
}

export interface ReportingFilters {
  readonly tenantId: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly clientId?: string;
  readonly teamId?: string;
  readonly technicianId?: string;
  readonly categoryId?: string;
  readonly serviceId?: string;
  readonly priority?: ReportingPriority;
  readonly contractId?: string;
}

export interface ReportingAccessContext {
  readonly authorizedTenantIds: readonly string[];
  readonly canViewReports: boolean;
  readonly canExportReports: boolean;
}

export interface DashboardMetrics {
  readonly backlog: number;
  readonly volume: number;
  readonly resolutions: number;
  readonly averageFirstResponseMinutes: number | null;
  readonly averageResolutionMinutes: number | null;
  readonly slaCompliance: {
    readonly met: number;
    readonly evaluated: number;
    readonly percentage: number | null;
  };
  readonly contractConsumption: {
    readonly consumedMinutes: number;
    readonly includedMinutes: number | null;
    readonly remainingMinutes: number | null;
  } | null;
}

export interface ExportPolicy {
  /** Legal approval is required before any data can leave the service desk. */
  readonly legalApproved: boolean;
  readonly allowedFields: readonly ExportField[];
  readonly maximumRows: number;
}

export interface ExportAuditRecord {
  readonly action: "report.exported";
  readonly tenantId: string;
  readonly exportedAt: Date;
  readonly rowCount: number;
  readonly fields: readonly ExportField[];
  readonly justification: string;
}

export interface ReportExport {
  readonly contentType: "text/csv";
  readonly fileName: string;
  readonly csv: string;
  readonly rowCount: number;
}

const closedStatuses = new Set(["resolved", "closed"]);

/**
 * Validates reporting access and forces callers to name a tenant before any
 * reporting predicate or aggregation is evaluated.
 */
export function assertReportingAccess(context: ReportingAccessContext, filters: ReportingFilters): void {
  if (!context.canViewReports) {
    throw new Error("Report viewing is not authorized.");
  }
  if (filters.tenantId.trim().length === 0 || !context.authorizedTenantIds.includes(filters.tenantId)) {
    throw new Error("Reports require an authorized tenant scope.");
  }
  if (filters.from !== undefined && !isValidDate(filters.from)) {
    throw new Error("Report start dates must be valid.");
  }
  if (filters.to !== undefined && !isValidDate(filters.to)) {
    throw new Error("Report end dates must be valid.");
  }
  if (filters.from !== undefined && filters.to !== undefined && filters.from > filters.to) {
    throw new Error("Report start dates must not be after end dates.");
  }
}

/**
 * Returns records scoped to the authorized tenant before any user-selected
 * filter is evaluated. Persistence/RLS remains the authoritative boundary.
 */
export function queryReportingTickets(
  tickets: readonly ReportingTicket[],
  filters: ReportingFilters,
  context: ReportingAccessContext
): readonly ReportingTicket[] {
  assertReportingAccess(context, filters);

  return tickets
    .filter((ticket) => ticket.tenantId === filters.tenantId)
    .filter((ticket) => matchesFilters(ticket, filters));
}

/** Calculates dashboard values from an already tenant-delimited query result. */
export function calculateDashboardMetrics(
  tickets: readonly ReportingTicket[],
  consumption: readonly ContractConsumptionMetric[],
  filters: ReportingFilters,
  context: ReportingAccessContext
): DashboardMetrics {
  const scopedTickets = queryReportingTickets(tickets, filters, context);
  const scopedConsumption = queryContractConsumption(consumption, filters, context);
  const resolved = scopedTickets.filter((ticket) => ticket.resolvedAt !== null);
  const firstResponseMinutes = scopedTickets.flatMap((ticket) =>
    ticket.firstRespondedAt === null ? [] : [minutesBetween(ticket.createdAt, ticket.firstRespondedAt)]
  );
  const resolutionMinutes = resolved.map((ticket) => minutesBetween(ticket.createdAt, ticket.resolvedAt as Date));
  const slaEvaluated = resolved.filter((ticket) => ticket.slaResolutionDueAt !== null);
  const slaMet = slaEvaluated.filter((ticket) => (ticket.resolvedAt as Date) <= (ticket.slaResolutionDueAt as Date)).length;

  return {
    backlog: scopedTickets.filter((ticket) => !closedStatuses.has(ticket.status)).length,
    volume: scopedTickets.length,
    resolutions: resolved.length,
    averageFirstResponseMinutes: average(firstResponseMinutes),
    averageResolutionMinutes: average(resolutionMinutes),
    slaCompliance: {
      met: slaMet,
      evaluated: slaEvaluated.length,
      percentage: slaEvaluated.length === 0 ? null : (slaMet / slaEvaluated.length) * 100
    },
    contractConsumption: contractConsumption(scopedConsumption)
  };
}

/**
 * Generates a policy-governed CSV and records its audit event only after all
 * authorization, scope, field, and row-limit checks pass.
 */
export function exportReportCsv(
  tickets: readonly ReportingTicket[],
  filters: ReportingFilters,
  context: ReportingAccessContext,
  policy: ExportPolicy,
  fields: readonly ExportField[],
  justification: string,
  exportedAt: Date,
  recordAudit: (record: ExportAuditRecord) => void
): ReportExport {
  assertReportingAccess(context, filters);
  if (!context.canExportReports) {
    throw new Error("Report export is not authorized.");
  }
  if (!policy.legalApproved) {
    throw new Error("Report exports require legal-policy approval.");
  }
  if (!Number.isInteger(policy.maximumRows) || policy.maximumRows < 1) {
    throw new Error("Export policy must specify a positive row limit.");
  }
  if (fields.length === 0 || fields.some((field) => !policy.allowedFields.includes(field))) {
    throw new Error("Requested export fields are not permitted by policy.");
  }
  if (justification.trim().length === 0 || !isValidDate(exportedAt)) {
    throw new Error("Exports require a justification and valid audit timestamp.");
  }

  const scopedTickets = queryReportingTickets(tickets, filters, context);
  if (scopedTickets.length > policy.maximumRows) {
    throw new Error("Export exceeds the configured row limit.");
  }

  const csv = [fields.join(","), ...scopedTickets.map((ticket) => fields.map((field) => csvValue(exportValue(ticket, field))).join(","))].join("\n");
  recordAudit({
    action: "report.exported",
    tenantId: filters.tenantId,
    exportedAt: new Date(exportedAt),
    rowCount: scopedTickets.length,
    fields: [...fields],
    justification: justification.trim()
  });

  return {
    contentType: "text/csv",
    fileName: `report-${filters.tenantId}-${exportedAt.toISOString().slice(0, 10)}.csv`,
    csv,
    rowCount: scopedTickets.length
  };
}

function queryContractConsumption(
  records: readonly ContractConsumptionMetric[],
  filters: ReportingFilters,
  context: ReportingAccessContext
): readonly ContractConsumptionMetric[] {
  assertReportingAccess(context, filters);
  return records
    .filter((record) => record.tenantId === filters.tenantId)
    .filter((record) => filters.contractId === undefined || record.contractId === filters.contractId)
    .filter((record) => filters.from === undefined || record.recordedAt >= filters.from)
    .filter((record) => filters.to === undefined || record.recordedAt <= filters.to);
}

function matchesFilters(ticket: ReportingTicket, filters: ReportingFilters): boolean {
  return (
    (filters.from === undefined || ticket.createdAt >= filters.from) &&
    (filters.to === undefined || ticket.createdAt <= filters.to) &&
    (filters.clientId === undefined || ticket.clientId === filters.clientId) &&
    (filters.teamId === undefined || ticket.teamId === filters.teamId) &&
    (filters.technicianId === undefined || ticket.technicianId === filters.technicianId) &&
    (filters.categoryId === undefined || ticket.categoryId === filters.categoryId) &&
    (filters.serviceId === undefined || ticket.serviceId === filters.serviceId) &&
    (filters.priority === undefined || ticket.priority === filters.priority) &&
    (filters.contractId === undefined || ticket.contractId === filters.contractId)
  );
}

function contractConsumption(records: readonly ContractConsumptionMetric[]): DashboardMetrics["contractConsumption"] {
  if (records.length === 0) {
    return null;
  }
  const consumedMinutes = records.reduce((total, record) => total + record.consumedMinutes, 0);
  const includedMinutes = records.some((record) => record.includedMinutes === null)
    ? null
    : records.reduce((total, record) => total + (record.includedMinutes as number), 0);
  return {
    consumedMinutes,
    includedMinutes,
    remainingMinutes: includedMinutes === null ? null : includedMinutes - consumedMinutes
  };
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}

function minutesBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 60_000;
}

function exportValue(ticket: ReportingTicket, field: ExportField): string {
  const value = ticket[field];
  return value instanceof Date ? value.toISOString() : value === null ? "" : String(value);
}

function csvValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}
