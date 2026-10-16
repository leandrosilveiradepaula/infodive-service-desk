import type { TicketCommentVisibility, TicketStatus } from "../domain/ticket";

export type AgentQueue = "all" | "assigned_to_me" | "unassigned";
export type AgentSortField = "updated_at" | "created_at" | "priority";
export type AgentSortDirection = "asc" | "desc";

export interface AgentTicketSummary {
  readonly id: string;
  readonly subject: string;
  readonly status: TicketStatus;
  readonly priority: number;
  readonly assigneeUserId: string | null;
  readonly requesterName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentInboxFilters {
  readonly queue: AgentQueue;
  readonly statuses?: readonly TicketStatus[];
  readonly query?: string;
  readonly sort: AgentSortField;
  readonly direction: AgentSortDirection;
}

export interface SavedAgentView {
  readonly id: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly filters: AgentInboxFilters;
  readonly createdAt: string;
}

export interface AgentPermissions {
  /** Presentation hints only; ticket commands must remain authorized by the server. */
  readonly canReplyPublic: boolean;
  readonly canAddInternalNote: boolean;
  readonly canRecordActivity: boolean;
  readonly canAssign: boolean;
  readonly canTransfer: boolean;
  readonly canChangeStatus: boolean;
}

export interface AgentComment {
  readonly id: string;
  readonly authorName: string;
  readonly body: string;
  readonly visibility: TicketCommentVisibility;
  readonly createdAt: string;
}

export interface AgentAttachment {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface AgentSlaSnapshot {
  readonly state: "on_track" | "at_risk" | "breached";
  readonly targetAt: string;
  readonly metric: "first_response" | "update" | "resolution";
}

export interface AgentTicketDetail extends AgentTicketSummary {
  readonly description: string | null;
  readonly teamName: string | null;
  readonly comments: readonly AgentComment[];
  readonly attachments: readonly AgentAttachment[];
  readonly sla?: AgentSlaSnapshot;
}

export interface AgentTicketActions {
  readonly replyPublic: boolean;
  readonly addInternalNote: boolean;
  readonly recordActivity: boolean;
  readonly assign: boolean;
  readonly transfer: boolean;
  readonly changeStatus: boolean;
}

export interface AgentTicketDetailModel {
  readonly ticket: Omit<AgentTicketDetail, "comments"> & { readonly comments: readonly AgentComment[] };
  readonly actions: AgentTicketActions;
  readonly slaAlert?: AgentSlaSnapshot;
}

export interface AgentWorkspaceLayout {
  readonly mode: "two_column" | "stacked";
  readonly inboxAriaLabel: string;
  readonly detailAriaLabel: string;
}

export interface AgentKeyboardShortcut {
  readonly key: string;
  readonly description: string;
  readonly target: "inbox" | "detail" | "composer";
}

const defaultFilters: AgentInboxFilters = {
  queue: "all",
  sort: "updated_at",
  direction: "desc"
};

/**
 * Filters tickets that were already scoped by the server to the current agent's
 * permitted tenant and customer-company access. It must not be used as an
 * authorization boundary.
 */
export function buildAgentInbox(
  tickets: readonly AgentTicketSummary[],
  currentUserId: string,
  filters: Partial<AgentInboxFilters> = {}
): readonly AgentTicketSummary[] {
  const effectiveFilters: AgentInboxFilters = { ...defaultFilters, ...filters };
  const normalizedQuery = effectiveFilters.query?.trim().toLocaleLowerCase();

  return tickets
    .filter((ticket) => matchesQueue(ticket, currentUserId, effectiveFilters.queue))
    .filter((ticket) => effectiveFilters.statuses === undefined || effectiveFilters.statuses.includes(ticket.status))
    .filter((ticket) => {
      if (normalizedQuery === undefined || normalizedQuery.length === 0) {
        return true;
      }
      return `${ticket.id} ${ticket.subject} ${ticket.requesterName}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    })
    .slice()
    .sort((left, right) => compareTickets(left, right, effectiveFilters));
}

/** Creates an immutable saved inbox configuration owned by the current user. */
export function createSavedAgentView(input: {
  id: string;
  ownerUserId: string;
  name: string;
  filters: AgentInboxFilters;
  createdAt: string;
}): SavedAgentView {
  const id = requiredText(input.id, "A saved view identifier is required.");
  const ownerUserId = requiredText(input.ownerUserId, "A saved view owner is required.");
  const name = requiredText(input.name, "A saved view name is required.");

  return {
    id,
    ownerUserId,
    name,
    filters: copyFilters(input.filters),
    createdAt: input.createdAt
  };
}

/** Applies a selected saved view without mutating its stored configuration. */
export function applySavedAgentView(view: SavedAgentView): AgentInboxFilters {
  return copyFilters(view.filters);
}

/**
 * Builds a safe presentation model. Internal notes are omitted unless the
 * supplied capability permits them, providing a defence-in-depth UI guard in
 * addition to the API's server-side authorization and filtering.
 */
export function buildAgentTicketDetail(
  ticket: AgentTicketDetail,
  permissions: AgentPermissions
): AgentTicketDetailModel {
  const comments = permissions.canAddInternalNote
    ? ticket.comments
    : ticket.comments.filter((comment) => comment.visibility === "public");
  const { comments: _comments, ...ticketWithoutComments } = ticket;

  return {
    ticket: { ...ticketWithoutComments, comments },
    actions: {
      replyPublic: permissions.canReplyPublic,
      addInternalNote: permissions.canAddInternalNote,
      recordActivity: permissions.canRecordActivity,
      assign: permissions.canAssign,
      transfer: permissions.canTransfer,
      changeStatus: permissions.canChangeStatus
    },
    slaAlert: ticket.sla?.state === "on_track" ? undefined : ticket.sla
  };
}

/** Keeps essential inbox/detail navigation usable on narrow screens. */
export function getAgentWorkspaceLayout(viewportWidth: number): AgentWorkspaceLayout {
  return {
    mode: viewportWidth < 768 ? "stacked" : "two_column",
    inboxAriaLabel: "Ticket inbox",
    detailAriaLabel: "Selected ticket details"
  };
}

/** Keyboard targets are exposed to renderers so shortcuts remain discoverable. */
export function getAgentKeyboardShortcuts(actions: AgentTicketActions): readonly AgentKeyboardShortcut[] {
  const shortcuts: AgentKeyboardShortcut[] = [
    { key: "Alt+I", description: "Focus the ticket inbox", target: "inbox" },
    { key: "Alt+D", description: "Focus ticket details", target: "detail" }
  ];

  if (actions.replyPublic || actions.addInternalNote) {
    shortcuts.push({ key: "Alt+R", description: "Focus the reply composer", target: "composer" });
  }

  return shortcuts;
}

function matchesQueue(ticket: AgentTicketSummary, currentUserId: string, queue: AgentQueue): boolean {
  if (queue === "assigned_to_me") {
    return ticket.assigneeUserId === currentUserId;
  }
  if (queue === "unassigned") {
    return ticket.assigneeUserId === null;
  }
  return true;
}

function compareTickets(
  left: AgentTicketSummary,
  right: AgentTicketSummary,
  filters: AgentInboxFilters
): number {
  let comparison: number;
  if (filters.sort === "priority") {
    comparison = left.priority - right.priority;
  } else {
    const field = filters.sort === "created_at" ? "createdAt" : "updatedAt";
    comparison = left[field].localeCompare(right[field]);
  }

  if (comparison === 0) {
    comparison = left.id.localeCompare(right.id);
  }
  return filters.direction === "asc" ? comparison : -comparison;
}

function copyFilters(filters: AgentInboxFilters): AgentInboxFilters {
  return {
    queue: filters.queue,
    statuses: filters.statuses === undefined ? undefined : [...filters.statuses],
    query: filters.query,
    sort: filters.sort,
    direction: filters.direction
  };
}

function requiredText(value: string, message: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(message);
  }
  return normalized;
}
