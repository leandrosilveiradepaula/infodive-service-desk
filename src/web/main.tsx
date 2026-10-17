import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../components/navigation/app-shell";
import { AuthenticationProvider, type AuthenticatedProfile, type UserRole } from "../ui/authentication/auth-context";
import { loadVerifiedSession } from "../authentication/load-session";

const allowedRoles = new Set<string>(["tenant_administrator","service_manager","service_agent","requester","customer_administrator","customer_user"]);
function toProfile(value: Awaited<ReturnType<typeof loadVerifiedSession>>["profile"]): AuthenticatedProfile | null {
  if (!value || !value.roles.every(role => allowedRoles.has(role))) return null;
  return { userId: value.userId, displayName: value.displayName, email: value.email,
    tenantName: value.tenantName, roles: value.roles as UserRole[] };
}
function LoginForm({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [tenants, setTenants] = useState<readonly { id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const csrf = await fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" });
      if (!csrf.ok) throw Error("Falha ao iniciar autenticação.");
      const data = await csrf.json() as { csrfToken?: string };
      if (!data.csrfToken) throw Error("Falha de segurança da sessão.");
      const response = await fetch("/api/auth/login", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "x-csrf-token": data.csrfToken },
        body: JSON.stringify({ email, password, tenantId })
      });
      if (response.status === 409) {
        const result = await response.json() as { code?: string; tenants?: { id: string; name: string }[] };
        if (result.code === "tenant_selection_required" && Array.isArray(result.tenants) &&
            result.tenants.length > 1 && result.tenants.length <= 50 && result.tenants.every(item =>
              typeof item.id === "string" && typeof item.name === "string")) {
          setTenants(result.tenants);
          setError("Selecione sua empresa e confirme o acesso.");
          return;
        }
      }
      if (!response.ok) throw Error("Não foi possível autenticar. Verifique suas credenciais e empresa.");
      setPassword("");
      onAuthenticated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha de autenticação.");
    } finally { setBusy(false); }
  }
  return <form onSubmit={event => { void submit(event); }}>
    <h2>Acessar Service Desk</h2>
    <label>E-mail <input type="email" autoComplete="username" required value={email}
      onChange={event => setEmail(event.target.value)} /></label>
    <label>Senha <input type="password" autoComplete="current-password" required value={password}
      onChange={event => setPassword(event.target.value)} /></label>
    {tenants.length > 1 && <label>Empresa <select required value={tenantId}
      onChange={event => setTenantId(event.target.value)}><option value="">Selecione uma empresa</option>
      {tenants.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>}
    <button type="submit" disabled={busy}>{busy ? "Entrando..." : "Entrar"}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
function LogoutButton({ onLogout }: { onLogout: () => void }) {
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      const csrf = await fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" });
      if (!csrf.ok) throw Error("CSRF");
      const payload = await csrf.json() as { csrfToken?: string };
      if (!payload.csrfToken) throw Error("CSRF");
      const result = await fetch("/api/auth/logout", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "x-csrf-token": payload.csrfToken }
      });
      // The server clears local cookies even when provider revocation returns 503.
      if (!result.ok && result.status !== 503) throw Error("Logout");
      onLogout();
    } catch { setBusy(false); }
  }
  return <button type="button" disabled={busy} onClick={() => { void logout(); }}>Sair</button>;
}

interface TicketItem {
  id: string; tenantId: string; protocol: string; subject: string;
  description: string | null; priority: string; status: string;
  createdAt: string; updatedAt: string;
}
function TicketsPanel() {
  const [items, setItems] = useState<TicketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<TicketItem | null>(null);
  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/tickets", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw Error("Não foi possível consultar os chamados. Verifique suas permissões.");
      const data = await response.json() as { items?: TicketItem[] };
      if (!Array.isArray(data.items)) throw Error("A lista de chamados é inválida.");
      setItems(data.items);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao consultar chamados."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError("");
    try {
      const csrf = await fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" });
      const data = await csrf.json() as { csrfToken?: string };
      if (!csrf.ok || !data.csrfToken) throw Error("Não foi possível iniciar a operação.");
      const response = await fetch("/api/tickets", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "x-csrf-token": data.csrfToken },
        body: JSON.stringify({ subject, description, priority })
      });
      if (!response.ok) throw Error(response.status === 403 ?
        "Você não tem permissão para abrir chamados nesta empresa." : "Não foi possível salvar o chamado.");
      const payload = await response.json() as { ticket?: TicketItem };
      if (!payload.ticket) throw Error("Resposta inválida ao salvar chamado.");
      setSubject(""); setDescription(""); setPriority("normal");
      setSelected(payload.ticket);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao salvar."); }
    finally { setSaving(false); }
  }
  return <section>
    <h2>Chamados da sua empresa</h2>
    <p>Abra uma solicitação ou acompanhe os chamados registrados no sistema.</p>
    <form onSubmit={event => { void createTicket(event); }}>
      <h3>Novo chamado</h3>
      <label>Assunto <input required minLength={3} maxLength={240} value={subject}
        onChange={event => setSubject(event.target.value)} /></label>
      <label>Descrição <textarea maxLength={5000} value={description}
        onChange={event => setDescription(event.target.value)} /></label>
      <label>Prioridade <select value={priority} onChange={event => setPriority(event.target.value)}>
        <option value="low">Baixa</option><option value="normal">Normal</option>
        <option value="high">Alta</option><option value="urgent">Urgente</option>
      </select></label>
      <button type="submit" disabled={saving}>{saving ? "Salvando..." : "Abrir chamado"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <h3>Chamados recentes</h3>
    <button type="button" onClick={() => { void load(); }} disabled={loading}>Atualizar</button>
    {loading ? <p>Carregando chamados...</p> : items.length === 0 ?
      <p>Nenhum chamado encontrado.</p> :
      <ul>{items.map(item => <li key={item.id}>
        <button type="button" onClick={() => setSelected(item)}>
          {item.protocol} — {item.subject} ({item.status})
        </button>
      </li>)}</ul>}
    {selected && <article><h3>{selected.protocol} — {selected.subject}</h3>
      <p>Status: {selected.status} · Prioridade: {selected.priority}</p>
      <p>{selected.description || "Sem descrição adicional."}</p>
      <button type="button" onClick={() => setSelected(null)}>Fechar detalhes</button>
    </article>}
  </section>;
}
function Application() {
  const [profile, setProfile] = useState<AuthenticatedProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void loadVerifiedSession((url, init) => fetch(url, init)).then(session => {
      if (active) setProfile(toProfile(session.profile));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    if (!profile) return;
    let active = true;
    const renew = async () => {
      try {
        const csrf = await fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" });
        if (!csrf.ok) throw Error("CSRF bootstrap failed");
        const body: unknown = await csrf.json();
        const token = typeof body === "object" && body !== null && "csrfToken" in body
          ? (body as { csrfToken?: unknown }).csrfToken : null;
        if (typeof token !== "string") throw Error("Invalid CSRF token");
        const refreshed = await fetch("/api/auth/refresh", {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "x-csrf-token": token }
        });
        if (!refreshed.ok) throw Error("Session refresh rejected");
        if (active) setRevision(previous => previous + 1);
      } catch {
        if (active) setProfile(null);
      }
    };
    // Refresh before the one-hour tenant signature expires. No token enters JS.
    const timer = window.setInterval(() => { void renew(); }, 25 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [profile]);
  if (loading) return <main><p>Verificando sessão...</p></main>;
  if (profile === null) return <main className="loginPage">
    <LoginForm onAuthenticated={() => { setLoading(true); setRevision(value => value + 1); }} />
  </main>;
  const signOut = async () => {
    const csrf = await fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" });
    const payload = await csrf.json() as { csrfToken?: string };
    if (!csrf.ok || !payload.csrfToken) throw Error("Falha ao sair.");
    const response = await fetch("/api/auth/logout", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "x-csrf-token": payload.csrfToken }
    });
    if (!response.ok && response.status !== 503) throw Error("Falha ao sair.");
    setProfile(null);
    setRevision(value => value + 1);
  };
  return <AuthenticationProvider profile={profile} onSignOut={signOut}>
    <AppShell pageTitle="Central de atendimento" currentPath="/">
      <section><h2>Bem-vindo ao Service Desk</h2>
        <p>Olá, {profile.displayName}. Sua identidade foi verificada para {profile.tenantName}.</p>
        <TicketsPanel />
        <LogoutButton onLogout={() => { setProfile(null); setRevision(value => value + 1); }} />
      </section>
    </AppShell>
  </AuthenticationProvider>;
}
const root = document.getElementById("root");
if (root === null) throw new Error("Missing application root element.");
createRoot(root).render(<StrictMode><Application /></StrictMode>);
