export interface TimeEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly contractId: string | null;
  readonly ticketId: string | null;
  readonly authorUserId: string;
  readonly workedAt: Date;
  readonly minutes: number;
  readonly description: string;
}

export interface ContractConsumption {
  readonly contractId: string;
  readonly timeEntryId: string;
  readonly consumedMinutes: number;
  readonly recordedAt: Date;
}

/** Validates a time entry before its immutable accounting record is persisted. */
export function assertValidTimeEntry(entry: TimeEntry): void {
  if (entry.id.trim().length === 0 || entry.tenantId.trim().length === 0 || entry.authorUserId.trim().length === 0) {
    throw new Error("Time entries require identifiers and tenant scope.");
  }
  if (!Number.isInteger(entry.minutes) || entry.minutes <= 0) {
    throw new Error("Time entry minutes must be a positive whole number.");
  }
  if (entry.description.trim().length === 0 || Number.isNaN(entry.workedAt.getTime())) {
    throw new Error("Time entries require a description and worked timestamp.");
  }
}

/** Creates the append-only consumption snapshot used by contract balance reporting. */
export function createContractConsumption(entry: TimeEntry, recordedAt: Date): ContractConsumption {
  assertValidTimeEntry(entry);
  if (entry.contractId === null) {
    throw new Error("Only contract-linked time entries can consume contract hours.");
  }
  return {
    contractId: entry.contractId,
    timeEntryId: entry.id,
    consumedMinutes: entry.minutes,
    recordedAt: new Date(recordedAt)
  };
}

/** Totals immutable consumption snapshots; later contract changes do not rewrite history. */
export function totalConsumedMinutes(consumption: readonly ContractConsumption[], contractId: string): number {
  return consumption
    .filter((record) => record.contractId === contractId)
    .reduce((total, record) => total + record.consumedMinutes, 0);
}
