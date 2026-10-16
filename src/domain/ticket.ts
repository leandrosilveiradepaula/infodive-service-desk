export type TicketStatus =
  | "new"
  | "open"
  | "in_progress"
  | "waiting_customer"
  | "waiting_third_party"
  | "resolved"
  | "closed"
  | "reopened";

export type TicketCommentVisibility = "public" | "internal";
export type TicketRelationshipType = "relates_to" | "blocks" | "blocked_by" | "duplicates" | "duplicated_by" | "parent_of" | "child_of";

export interface TicketTransitionRule {
  readonly from: TicketStatus;
  readonly to: TicketStatus;
  readonly enabled: boolean;
}

export interface TicketCommentAccessContext {
  readonly userId: string | null;
  readonly canReadTicket: boolean;
  readonly canManageTicket: boolean;
}

export interface TicketComment {
  readonly authorUserId: string;
  readonly visibility: TicketCommentVisibility;
}

export interface TicketReference {
  readonly id: string;
  readonly tenantId: string;
}

const defaultTransitions: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  new: ["open", "in_progress", "waiting_customer", "waiting_third_party", "resolved", "closed"],
  open: ["in_progress", "waiting_customer", "waiting_third_party", "resolved", "closed"],
  in_progress: ["open", "waiting_customer", "waiting_third_party", "resolved", "closed"],
  waiting_customer: ["open", "in_progress", "waiting_third_party", "resolved", "closed"],
  waiting_third_party: ["open", "in_progress", "waiting_customer", "resolved", "closed"],
  resolved: ["open", "in_progress", "closed", "reopened"],
  closed: ["reopened"],
  reopened: ["open", "in_progress", "waiting_customer", "waiting_third_party", "resolved", "closed"]
};

/** Evaluates a status transition using tenant-configured rules when supplied. */
export function canTransitionTicket(
  currentStatus: TicketStatus,
  nextStatus: TicketStatus,
  configuredRules?: readonly TicketTransitionRule[]
): boolean {
  if (currentStatus === nextStatus) {
    return false;
  }

  if (configuredRules !== undefined) {
    return configuredRules.some(
      (rule) => rule.from === currentStatus && rule.to === nextStatus && rule.enabled
    );
  }

  return defaultTransitions[currentStatus].includes(nextStatus);
}

/** Throws when a ticket status change is not allowed by the active rules. */
export function assertTicketTransition(
  currentStatus: TicketStatus,
  nextStatus: TicketStatus,
  configuredRules?: readonly TicketTransitionRule[]
): void {
  if (!canTransitionTicket(currentStatus, nextStatus, configuredRules)) {
    throw new Error(`Cannot transition a ${currentStatus} ticket to ${nextStatus}.`);
  }
}

/** Internal comments are visible only to ticket managers; public comments follow ticket read access. */
export function canReadTicketComment(
  comment: TicketComment,
  context: TicketCommentAccessContext
): boolean {
  if (context.userId === null) {
    return false;
  }

  if (comment.visibility === "internal") {
    return context.canManageTicket;
  }

  return context.canReadTicket;
}

/** Ensures linked tickets cannot cross tenant boundaries or point to themselves. */
export function assertTicketRelationship(
  source: TicketReference,
  target: TicketReference,
  relationshipType: TicketRelationshipType
): void {
  if (source.tenantId !== target.tenantId) {
    throw new Error("Related tickets must belong to the same tenant.");
  }
  if (source.id === target.id) {
    throw new Error("A ticket cannot be related to itself.");
  }
  if (relationshipType.trim().length === 0) {
    throw new Error("A relationship type is required.");
  }
}
