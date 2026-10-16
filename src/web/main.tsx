import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../components/navigation/app-shell";
import { AuthenticationProvider } from "../ui/authentication/auth-context";

// Fail closed. The current product has no verified server-side session/profile
// endpoint yet. Never forge a demo principal or expose a service-role secret to
// the browser to make a Preview look logged in. The UI will display the
// existing unauthenticated state until secure session wiring is implemented.
function Application() {
  return (
    <AuthenticationProvider profile={null}>
      <AppShell pageTitle="Início" currentPath="/">
        <p>Os recursos aparecem após autenticação e autorização reais.</p>
      </AppShell>
    </AuthenticationProvider>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("Missing application root element.");
createRoot(root).render(<StrictMode><Application /></StrictMode>);
