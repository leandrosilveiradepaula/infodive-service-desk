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
    <label>Identificador da empresa <input type="text" required value={tenantId}
      onChange={event => setTenantId(event.target.value)} /></label>
    <button type="submit" disabled={busy}>{busy ? "Entrando..." : "Entrar"}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
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
  return <AuthenticationProvider profile={profile}>
    <AppShell pageTitle="Início" currentPath="/">
      {loading ? <p>Verificando sessão...</p> :
       profile === null ? <LoginForm onAuthenticated={() => { setLoading(true); setRevision(value => value + 1); }} /> :
       <p>Identidade verificada. As permissões continuam sendo aplicadas pelo servidor.</p>}
    </AppShell>
  </AuthenticationProvider>;
}
const root = document.getElementById("root");
if (root === null) throw new Error("Missing application root element.");
createRoot(root).render(<StrictMode><Application /></StrictMode>);
