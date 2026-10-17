/** User-bound ticket operations. PostgREST receives a user JWT, NEVER a service key. */
export interface TicketView {
  readonly id: string;
  readonly tenantId: string;
  readonly protocol: string;
  readonly subject: string;
  readonly description: string | null;
  readonly priority: "low" | "normal" | "high" | "urgent";
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface TicketResult { readonly status: number; readonly body: unknown; }
export interface TicketRequest {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly accessToken: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly method: string;
  readonly pathname: string;
  readonly body: string;
  readonly request: typeof fetch;
}
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const priorities = new Set(["low", "normal", "high", "urgent"]);
const select = "id,tenant_id,protocol,subject,description,priority,status,created_at,updated_at";

function mapRecord(value: unknown, tenantId: string): TicketView {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid ticket");
  const row = value as Record<string, unknown>;
  if (!uuid.test(String(row.id)) || row.tenant_id !== tenantId ||
      typeof row.protocol !== "string" || !row.protocol ||
      typeof row.subject !== "string" || typeof row.status !== "string" ||
      typeof row.created_at !== "string" || typeof row.updated_at !== "string" ||
      (row.description !== null && typeof row.description !== "string") ||
      typeof row.priority !== "string" || !priorities.has(row.priority)) {
    throw Error("Untrusted ticket record");
  }
  return {
    id: row.id as string, tenantId, protocol: row.protocol, subject: row.subject,
    description: row.description as string | null,
    priority: row.priority as TicketView["priority"], status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}
function errorStatus(status: number): TicketResult {
  if (status === 401) return { status: 401, body: { error: "authentication_required" } };
  if (status === 403) return { status: 403, body: { error: "ticket_permission_denied" } };
  if (status === 409) return { status: 409, body: { error: "ticket_conflict" } };
  return { status: 503, body: { error: "ticket_service_unavailable" } };
}
export async function executeTicketRequest(input: TicketRequest): Promise<TicketResult> {
  const { method, pathname, tenantId, userId, request } = input;
  if (!uuid.test(tenantId) || !uuid.test(userId) ||
      !input.accessToken || input.accessToken.length > 8192 ||
      !input.supabaseUrl.startsWith("https://") || !input.publishableKey.trim()) {
    return { status: 503, body: { error: "ticket_service_configuration" } };
  }
  const id = pathname.startsWith("/api/tickets/") ? pathname.slice("/api/tickets/".length) : null;
  if (id !== null && !uuid.test(id)) return { status: 400, body: { error: "invalid_ticket_id" } };
  const url = new URL(input.supabaseUrl.replace(/\/$/, "") + "/rest/v1/tickets");
  url.searchParams.set("select", select);
  url.searchParams.set("tenant_id", "eq." + tenantId);
  if (id) url.searchParams.set("id", "eq." + id);
  else {
    url.searchParams.set("order", "created_at.desc");
    url.searchParams.set("limit", "50");
  }
  let payload: Record<string, unknown> | undefined;
  if (method === "POST") {
    if (id !== null) return { status: 405, body: { error: "method_not_allowed" } };
    try {
      const decoded: unknown = JSON.parse(input.body);
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
        return { status: 400, body: { error: "invalid_ticket_input" } };
      payload = decoded as Record<string, unknown>;
    } catch { return { status: 400, body: { error: "invalid_ticket_input" } }; }
    const subject = payload.subject;
    const description = payload.description ?? "";
    const priority = payload.priority ?? "normal";
    if (typeof subject !== "string" || subject.trim().length < 3 || subject.trim().length > 240 ||
        typeof description !== "string" || description.trim().length > 5000 ||
        typeof priority !== "string" || !priorities.has(priority)) {
      return { status: 400, body: { error: "invalid_ticket_input" } };
    }
    payload = {
      tenant_id: tenantId, requester_user_id: userId, subject: subject.trim(),
      description: description.trim() || null, priority
    };
    // The database assigns protocol, status, identity and timestamps.
    url.searchParams.delete("order");
    url.searchParams.delete("limit");
  }
  try {
    const response = await request(url.toString(), {
      method,
      headers: {
        apikey: input.publishableKey,
        Authorization: "Bearer " + input.accessToken,
        Accept: "application/json",
        ...(method === "POST" ? {
          "Content-Type": "application/json",
          Prefer: "return=representation"
        } : {})
      },
      ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return errorStatus(response.status);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length > 50 ||
        (method === "POST" && rows.length !== 1) || (id !== null && rows.length > 1)) {
      return { status: 503, body: { error: "ticket_response_invalid" } };
    }
    const tickets = rows.map(item => mapRecord(item, tenantId));
    if (method === "POST") return { status: 201, body: { ticket: tickets[0] } };
    if (id !== null) return tickets.length
      ? { status: 200, body: { ticket: tickets[0] } }
      : { status: 404, body: { error: "ticket_not_found" } };
    return { status: 200, body: { items: tickets } };
  } catch {
    return { status: 503, body: { error: "ticket_service_unavailable" } };
  }
}
