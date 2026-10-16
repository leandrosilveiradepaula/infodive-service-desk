import {
  assertTicketTransition,
  type TicketCommentVisibility,
  type TicketStatus
} from "../../domain/ticket";
import {
  AuthorizationError,
  authorizeCommand,
  type AuthenticatedSession,
  type AuthorizationRepository
} from "../../authorization/authorize-command";

export interface TicketRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly clientCompanyId: string | null;
  readonly requesterUserId: string;
  readonly status: TicketStatus;
  readonly subject: string;
  readonly description: string | null;
  readonly teamId: string | null;
  readonly assigneeUserId: string | null;
}

export interface TicketCommentRecord {
  readonly id: string;
  readonly ticketId: string;
  readonly tenantId: string;
  readonly authorUserId: string;
  readonly body: string;
  readonly visibility: TicketCommentVisibility;
  readonly createdAt: string;
}

export interface TicketPage {
  readonly items: readonly TicketRecord[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface TicketWorkflowRepository {
  createTicket(input: {
    tenantId: string;
    requesterUserId: string;
    clientCompanyId?: string;
    subject: string;
    description?: string;
  }): Promise<TicketRecord>;
  findTicket(input: { tenantId: string; ticketId: string }): Promise<TicketRecord | null>;
  listTickets(input: {
    tenantId: string;
    clientCompanyId?: string;
    status?: TicketStatus;
    assigneeUserId?: string;
    query?: string;
    page: number;
    pageSize: number;
    sort: "created_at" | "updated_at";
    direction: "asc" | "desc";
  }): Promise<TicketPage>;
  updateTicket(input: {
    tenantId: string;
    ticketId: string;
    subject?: string;
    description?: string | null;
  }): Promise<TicketRecord>;
  assignTicket(input: {
    tenantId: string;
    ticketId: string;
    teamId?: string | null;
    assigneeUserId?: string | null;
    actorUserId: string;
  }): Promise<TicketRecord>;
  transferTicket(input: {
    tenantId: string;
    ticketId: string;
    teamId?: string | null;
    assigneeUserId?: string | null;
    reason?: string;
    actorUserId: string;
  }): Promise<TicketRecord>;
  addComment(input: {
    tenantId: string;
    ticketId: string;
    authorUserId: string;
    body: string;
    visibility: TicketCommentVisibility;
  }): Promise<TicketCommentRecord>;
  listVisibleComments(input: {
    tenantId: string;
    ticketId: string;
    includeInternal: boolean;
  }): Promise<readonly TicketCommentRecord[]>;
  changeStatus(input: {
    tenantId: string;
    ticketId: string;
    status: TicketStatus;
    actorUserId: string;
  }): Promise<TicketRecord>;
  bulkResolve(input: {
    tenantId: string;
    ticketIds: readonly string[];
    actorUserId: string;
  }): Promise<readonly TicketRecord[]>;
  recordAudit(input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

export interface TicketWorkflowContext {
  readonly session: AuthenticatedSession | null;
  readonly tenantId: string;
}

export class TicketWorkflowError extends Error {
  public constructor(
    public readonly code: "INVALID_TICKET_COMMAND" | "TICKET_NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "TicketWorkflowError";
  }
}

/**
 * Application boundary for ticket commands. Repository implementations must use
 * the request-bound database client so RLS remains the final data-access guard.
 */
export class TicketWorkflowService {
  public constructor(
    private readonly authorization: AuthorizationRepository,
    private readonly tickets: TicketWorkflowRepository
  ) {}

  public async create(
    context: TicketWorkflowContext,
    input: { clientCompanyId?: string; subject: string; description?: string }
  ): Promise<TicketRecord> {
    const session = this.requireSession(context);
    const subject = this.requiredText(input.subject, "A ticket subject is required.");
    const clientCompanyId = input.clientCompanyId === undefined
      ? undefined
      : this.requiredText(input.clientCompanyId, "Client company scope is invalid.");

    await this.authorize(context, "manage", clientCompanyId, { command: "ticket.create" });

    return clientCompanyId === undefined
      ? this.tickets.createTicket({
          tenantId: context.tenantId,
          requesterUserId: session.userId,
          subject,
          description: input.description
        })
      : this.tickets.createTicket({
          tenantId: context.tenantId,
          requesterUserId: session.userId,
          clientCompanyId,
          subject,
          description: input.description
        });
  }

  public async get(context: TicketWorkflowContext, ticketId: string): Promise<TicketRecord> {
    return this.findAuthorizedTicket(context, ticketId, "read");
  }

  public async list(
    context: TicketWorkflowContext,
    input: {
      clientCompanyId?: string;
      status?: TicketStatus;
      assigneeUserId?: string;
      query?: string;
      page?: number;
      pageSize?: number;
      sort?: "created_at" | "updated_at";
      direction?: "asc" | "desc";
    }
  ): Promise<TicketPage> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 25;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new TicketWorkflowError("INVALID_TICKET_COMMAND", "Pagination must use a page of at least one and a page size between 1 and 100.");
    }

    const query = input.query?.trim();
    if (query !== undefined && query.length > 200) {
      throw new TicketWorkflowError("INVALID_TICKET_COMMAND", "Ticket search text cannot exceed 200 characters.");
    }

    await this.authorize(context, "read", input.clientCompanyId, { command: "ticket.list" });
    return this.tickets.listTickets({
      tenantId: context.tenantId,
      clientCompanyId: input.clientCompanyId,
      status: input.status,
      assigneeUserId: input.assigneeUserId,
      query: query || undefined,
      page,
      pageSize,
      sort: input.sort ?? "updated_at",
      direction: input.direction ?? "desc"
    });
  }

  public async update(
    context: TicketWorkflowContext,
    ticketId: string,
    input: { subject?: string; description?: string | null }
  ): Promise<TicketRecord> {
    const ticket = await this.findAuthorizedTicket(context, ticketId, "manage");
    if (input.subject === undefined && input.description === undefined) {
      throw new TicketWorkflowError("INVALID_TICKET_COMMAND", "At least one ticket field must be provided.");
    }

    return this.tickets.updateTicket({
      tenantId: context.tenantId,
      ticketId: ticket.id,
      subject: input.subject === undefined ? undefined : this.requiredText(input.subject, "A ticket subject is required."),
      description: input.description
    });
  }

  public async assign(
    context: TicketWorkflowContext,
    ticketId: string,
    input: { teamId?: string | null; assigneeUserId?: string | null }
  ): Promise<TicketRecord> {
    const ticket = await this.findAuthorizedTicket(context, ticketId, "manage");
    if (input.teamId === undefined && input.assigneeUserId === undefined) {
      throw new TicketWorkflowError("INVALID_TICKET_COMMAND", "An assignment destination is required.");
    }

    return this.tickets.assignTicket({
      tenantId: context.tenantId,
      ticketId: ticket.id,
      teamId: input.teamId,
      assigneeUserId: input.assigneeUserId,
      actorUserId: this.requireSession(context).userId
    });
  }

  public async transfer(
    context: TicketWorkflowContext,
    ticketId: string,
    input: { teamId?: string | null; assigneeUserId?: string | null; reason?: string }
  ): Promise<TicketRecord> {
    const ticket = await this.findAuthorizedTicket(context, ticketId, "manage");
    if (input.teamId === undefined && input.assigneeUserId === undefined) {
      throw new TicketWorkflowError("INVALID_TICKET_COMMAND", "A transfer destination is required.");
    }

    return this.tickets.transferTicket({
      tenantId: context.tenantId,
      ticketId: ticket.id,
      teamId: input.teamId,
      assigneeUserId: input.assigneeUserId,
      reason: input.reason,
      actorUserId: this.requireSession(context).userId
    });
  }

  public async addComment(
    context: TicketWorkflowContext,
    ticketId: string,
    input: { body: string; visibility: TicketCommentVisibility }
  ): Promise<TicketCommentRecord> {
    const requiredAction = input.visibility === "internal" ? "manage" : "read";
    const ticket = await this.findAuthorizedTicket(context, ticketId, requiredAction);

    return this.tickets.addComment({
      tenantId: context.tenantId,
      ticketId: ticket.id,
      authorUserId: this.requireSession(context).userId,
      body: this.requiredText(input.body, "A comment body is required."),
      visibility: input.visibility
    });
  }

  public async listComments(
    context: TicketWorkflowContext,
    ticketId: string
  ): Promise<readonly TicketCommentRecord[]> {
    const ticket = await this.findAuthorizedTicket(context, ticketId, "read");
    let includeInternal = false;
    try {
      await this.authorize(context, "manage", ticket.clientCompanyId ?? undefined, { command: "ticket.comments.read_internal" });
      includeInternal = true;
    } catch (error) {
      if (!(error instanceof AuthorizationError)) {
        throw error;
      }
    }

    return this.tickets.listVisibleComments({
      tenantId: context.tenantId,
      ticketId: ticket.id,
      includeInternal
    });
  }

  public async resolve(context: TicketWorkflowContext, ticketId: string): Promise<TicketRecord> {
    const ticket = await this.findAuthorizedTicket(context, ticketId, "manage");
    assertTicketTransition(ticket.status, "resolved");
    return this.tickets.changeStatus({
      tenantId: context.tenantId,
      ticketId: ticket.id,
      status: "resolved",
      actorUserId: this.requireSession(context).userId
    });
  }

  public async bulkResolve(
    context: TicketWorkflowContext,
    input: { ticketIds: readonly string[]; confirmed: boolean }
  ): Promise<readonly TicketRecord[]> {
    if (input.confirmed !== true) {
      throw new TicketWorkflowError("INVALID_TICKET_COMMAND", "Bulk resolution requires explicit confirmation.");
    }
    if (input.ticketIds.length === 0 || input.ticketIds.length > 100) {
      throw new TicketWorkflowError("INVALID_TICKET_COMMAND", "Bulk resolution requires between 1 and 100 tickets.");
    }

    const uniqueTicketIds = [...new Set(input.ticketIds.map((ticketId) => ticketId.trim()))];
    if (uniqueTicketIds.some((ticketId) => ticketId.length === 0)) {
      throw new TicketWorkflowError("INVALID_TICKET_COMMAND", "Every ticket identifier is required.");
    }

    // A tenant-wide bulk command deliberately requires direct manage permission;
    // delegated grants are company-scoped and cannot safely span an unspecified set.
    await this.authorize(context, "manage", undefined, {
      command: "ticket.bulk_resolve",
      ticketCount: uniqueTicketIds.length,
      confirmed: true
    });
    const actorUserId = this.requireSession(context).userId;
    const resolved = await this.tickets.bulkResolve({
      tenantId: context.tenantId,
      ticketIds: uniqueTicketIds,
      actorUserId
    });
    await this.tickets.recordAudit({
      tenantId: context.tenantId,
      actorUserId,
      action: "ticket.bulk_resolve",
      metadata: { ticketIds: uniqueTicketIds, resolvedCount: resolved.length, confirmed: true }
    });
    return resolved;
  }

  private async findAuthorizedTicket(
    context: TicketWorkflowContext,
    ticketId: string,
    action: "read" | "manage"
  ): Promise<TicketRecord> {
    const normalizedTicketId = this.requiredText(ticketId, "A ticket identifier is required.");
    const ticket = await this.tickets.findTicket({ tenantId: context.tenantId, ticketId: normalizedTicketId });
    if (ticket === null) {
      throw new TicketWorkflowError("TICKET_NOT_FOUND", "The requested ticket was not found.");
    }
    await this.authorize(context, action, ticket.clientCompanyId ?? undefined, { command: `ticket.${action}` });
    return ticket;
  }

  private async authorize(
    context: TicketWorkflowContext,
    action: "read" | "manage",
    clientCompanyId: string | undefined,
    auditMetadata: Record<string, unknown>
  ): Promise<void> {
    await authorizeCommand(this.authorization, {
      session: context.session,
      tenantId: this.requiredText(context.tenantId, "A tenant scope is required."),
      resource: "ticket",
      action,
      clientCompanyId,
      auditMetadata
    });
  }

  private requireSession(context: TicketWorkflowContext): AuthenticatedSession {
    if (context.session === null) {
      throw new AuthorizationError("An authenticated session is required.");
    }
    return context.session;
  }

  private requiredText(value: string, message: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) {
      throw new TicketWorkflowError("INVALID_TICKET_COMMAND", message);
    }
    return normalized;
  }
}
