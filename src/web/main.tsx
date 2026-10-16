import { StrictMode, useEffect, useState } from "react";
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
function Application() {
  const [profile, setProfile] = useState<AuthenticatedProfile | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void loadVerifiedSession((url, init) => fetch(url, init)).then(session => {
      if (active) setProfile(toProfile(session.profile));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <AuthenticationProvider profile={profile}>
    <AppShell pageTitle="Início" currentPath="/">
      {loading ? <p>Verificando sessão...</p> :
       profile === null ? <p>Entre com uma conta autorizada para acessar os recursos.</p> :
       <p>Identidade verificada. As permissões continuam sendo aplicadas pelo servidor.</p>}
    </AppShell>
  </AuthenticationProvider>;
}
const root = document.getElementById("root");
if (root === null) throw new Error("Missing application root element.");
createRoot(root).render(<StrictMode><Application /></StrictMode>);
