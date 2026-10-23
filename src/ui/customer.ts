export type CustomerRole = "requester" | "manager";
export type CustomerTicketStatus =
  | "new"
  | "open"
  | "in_progress"
  | "waiting_customer"
  | "waiting_third_party"
  | "resolved"
  | "closed"
  | "reopened";

export interface CustomerSession {
  readonly userId: string;
  readonly companyId: string;
  readonly role: CustomerRole;
}

export interface CustomerComment {
  readonly id: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
  readonly visibility: "public" | "internal";
}

export interface CustomerHistoryEntry {
  readonly id: string;
  readonly description: string;
  readonly occurredAt: string;
  readonly visibility: "public" | "internal";
}

export interface CustomerAttachment {
  readonly id: string;
  readonly name: string;
  readonly downloadUrl: string;
  readonly visibility: "public" | "internal";
}

export interface CustomerTicket {
  readonly id: string;
  readonly protocol: string;
  readonly companyId: string;
  readonly requesterUserId: string;
  readonly requesterName: string;
  readonly subject: string;
  readonly description: string | null;
  readonly status: CustomerTicketStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly comments: readonly CustomerComment[];
  readonly history: readonly CustomerHistoryEntry[];
  readonly attachments: readonly CustomerAttachment[];
}

export interface CustomerTicketSummary {
  readonly id: string;
  readonly protocol: string;
  readonly subject: string;
  readonly status: CustomerTicketStatus;
  readonly requesterName?: string;
  readonly updatedAt: string;
}

export interface CustomerTicketDetail {
  readonly id: string;
  readonly protocol: string;
  readonly subject: string;
  readonly description: string | null;
  readonly status: CustomerTicketStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly comments: readonly CustomerComment[];
  readonly history: readonly CustomerHistoryEntry[];
  readonly attachments: readonly CustomerAttachment[];
  readonly canReply: boolean;
  readonly canAttachEvidence: boolean;
}

export interface CustomerPortalApi {
  listTickets(): Promise<readonly CustomerTicket[]>;
  getTicket(ticketId: string): Promise<CustomerTicket | null>;
  createTicket(input: { readonly subject: string; readonly description: string; readonly attachments: readonly CustomerEvidenceFile[] }): Promise<CustomerTicket>;
  addPublicComment(ticketId: string, body: string): Promise<CustomerComment>;
}

export interface CustomerEvidenceFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

export interface CustomerTicketForm {
  readonly subject: string;
  readonly description: string;
  readonly attachments: readonly CustomerEvidenceFile[];
}

export type CustomerFormField = "subject" | "description" | "attachments";
export type CustomerFormErrors = Readonly<Partial<Record<CustomerFormField, string>>>;

export const CUSTOMER_ATTACHMENT_LIMIT_BYTES = 10 * 1024 * 1024;

const allowedAttachmentTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

const allowedAttachmentExtensions = new Set([
  "pdf", "jpg", "jpeg", "png", "gif", "webp", "txt", "docx", "xlsx"
]);

/**
 * Produces an accessible validation summary: callers should connect each message
 * to its input with aria-describedby and announce the summary through a live region.
 */
export function validateCustomerTicketForm(form: CustomerTicketForm): CustomerFormErrors {
  const errors: Partial<Record<CustomerFormField, string>> = {};
  const subject = form.subject.trim();
  const description = form.description.trim();

  if (subject.length < 3 || subject.length > 240) {
    errors.subject = "Informe um assunto entre 3 e 240 caracteres.";
  }
  if (description.length === 0 || description.length > 10_000) {
    errors.description = "Descreva a solicitação em até 10.000 caracteres.";
  }

  const attachmentError = form.attachments.map(validateCustomerEvidence).find((error) => error !== null);
  if (attachmentError !== undefined) {
    errors.attachments = attachmentError;
  }

  return errors;
}

/** Conservative browser-side check. The upload service must repeat these checks. */
export function validateCustomerEvidence(file: CustomerEvidenceFile): string | null {
  const extension = file.name.trim().split(".").pop()?.toLowerCase() ?? "";
  if (file.name.trim().length === 0 || !allowedAttachmentExtensions.has(extension) || !allowedAttachmentTypes.has(file.type)) {
    return "Anexe somente PDF, imagens, TXT, DOCX ou XLSX. Arquivos executáveis não são permitidos.";
  }
  if (file.size <= 0 || file.size > CUSTOMER_ATTACHMENT_LIMIT_BYTES) {
    return "Cada anexo deve ter até 10 MB.";
  }
  return null;
}

/** Client-side shaping prevents accidental display; API/RLS authorization remains authoritative. */
export function canViewCustomerTicket(session: CustomerSession, ticket: CustomerTicket): boolean {
  if (ticket.companyId !== session.companyId) return false;
  return session.role === "manager" || ticket.requesterUserId === session.userId;
}

export function toCustomerTicketSummary(session: CustomerSession, ticket: CustomerTicket): CustomerTicketSummary | null {
  if (!canViewCustomerTicket(session, ticket)) return null;
  return {
    id: ticket.id,
    protocol: ticket.protocol,
    subject: ticket.subject,
    status: ticket.status,
    ...(session.role === "manager" ? { requesterName: ticket.requesterName } : {}),
    updatedAt: ticket.updatedAt
  };
}

export function toCustomerTicketDetail(session: CustomerSession, ticket: CustomerTicket): CustomerTicketDetail | null {
  if (!canViewCustomerTicket(session, ticket)) return null;

  return {
    id: ticket.id,
    protocol: ticket.protocol,
    subject: ticket.subject,
    description: ticket.description,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    comments: ticket.comments.filter((comment) => comment.visibility === "public"),
    history: ticket.history.filter((entry) => entry.visibility === "public"),
    attachments: ticket.attachments.filter((attachment) => attachment.visibility === "public"),
    canReply: true,
    canAttachEvidence: true
  };
}

export class CustomerPortalController {
  public constructor(
    private readonly session: CustomerSession,
    private readonly api: CustomerPortalApi
  ) {}

  public async list(): Promise<readonly CustomerTicketSummary[]> {
    const tickets = await this.api.listTickets();
    return tickets
      .map((ticket) => toCustomerTicketSummary(this.session, ticket))
      .filter((ticket): ticket is CustomerTicketSummary => ticket !== null);
  }

  public async detail(ticketId: string): Promise<CustomerTicketDetail | null> {
    const ticket = await this.api.getTicket(ticketId);
    return ticket === null ? null : toCustomerTicketDetail(this.session, ticket);
  }

  public async open(form: CustomerTicketForm): Promise<{ readonly ticket?: CustomerTicketDetail; readonly errors: CustomerFormErrors }> {
    const errors = validateCustomerTicketForm(form);
    if (Object.keys(errors).length > 0) return { errors };

    const ticket = await this.api.createTicket({
      subject: form.subject.trim(),
      description: form.description.trim(),
      attachments: form.attachments
    });
    return { ticket: toCustomerTicketDetail(this.session, ticket) ?? undefined, errors: {} };
  }

  public async reply(ticketId: string, body: string): Promise<CustomerComment> {
    const ticket = await this.api.getTicket(ticketId);
    if (ticket === null || !canViewCustomerTicket(this.session, ticket)) {
      throw new Error("Você não tem permissão para responder a este chamado.");
    }
    if (body.trim().length === 0) {
      throw new Error("Escreva uma resposta antes de enviar.");
    }
    return this.api.addPublicComment(ticketId, body.trim());
  }
}
