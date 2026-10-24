"use client";

import { useState, type ReactNode } from "react";
import { useAuthentication, type UserRole } from "../../ui/authentication/auth-context";
import styles from "../../styles/app-shell.module.css";

export interface NavigationItem {
  readonly label: string;
  readonly href: string;
  readonly description?: string;
  readonly roles?: readonly UserRole[];
}

export type ContentStatus = "loading" | "empty" | "error" | "success";

export interface ContentStateProps {
  readonly status: ContentStatus;
  readonly title?: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly children?: ReactNode;
}

const defaultNavigation: readonly NavigationItem[] = [
  { label: "Início", href: "/" },
  {
    label: "Chamados",
    href: "/chamados",
    roles: ["tenant_administrator", "service_manager", "service_agent", "requester", "customer_administrator", "customer_user"]
  },
  {
    label: "Empresas", 
    href: "/empresas",
    roles: ["tenant_administrator", "service_manager", "customer_administrator"]
  },
  {
    label: "Pessoas e acessos",
    href: "/acessos",
    roles: ["tenant_administrator", "customer_administrator"]
  },
  {
    label: "Configurações",
    href: "/configuracoes",
    roles: ["tenant_administrator", "service_manager"]
  }
];

const statusCopy: Record<ContentStatus, { title: string; description: string }> = {
  loading: {
    title: "Carregando informações",
    description: "Aguarde enquanto atualizamos esta área."
  },
  empty: {
    title: "Ainda não há itens",
    description: "Quando houver informações disponíveis, elas aparecerão aqui."
  },
  error: {
    title: "Não foi possível carregar",
    description: "Verifique sua conexão e tente novamente."
  },
  success: {
    title: "Operação concluída",
    description: "Sua alteração foi salva com sucesso."
  }
};

/** Estado visual reutilizável para carregamento, vazio, erro e sucesso. */
export function ContentState({ status, title, description, action, children }: ContentStateProps) {
  const copy = statusCopy[status];
  const isError = status === "error";

  return (
    <section
      className={`${styles.contentState} ${styles[`state${status[0].toUpperCase()}${status.slice(1)}`]}`}
      aria-live={isError || status === "success" ? "polite" : undefined}
      aria-busy={status === "loading"}
      role={isError ? "alert" : undefined}
    >
      {status === "loading" && <span className={styles.spinner} aria-label="Carregando" />}
      <div>
        <h2>{title ?? copy.title}</h2>
        <p>{description ?? copy.description}</p>
        {children}
      </div>
      {action !== undefined && <div className={styles.stateAction}>{action}</div>}
    </section>
  );
}

export interface AppShellProps {
  readonly children: ReactNode;
  readonly pageTitle: string;
  readonly currentPath?: string;
  readonly navigation?: readonly NavigationItem[];
  readonly onNavigate?: (path: string) => void;
}

/**
 * Estrutura principal autenticada. A visibilidade dos links melhora a experiência,
 * mas não concede permissões: ações e dados seguem protegidos no servidor e por RLS.
 */
export function AppShell({
  children,
  pageTitle,
  currentPath,
  navigation = defaultNavigation,
  onNavigate
}: AppShellProps) {
  const { isAuthenticated, profile, hasAnyRole, signOut } = useAuthentication();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [isSigningOut, setIsSigningOut] = useState(false);

  const visibleNavigation = navigation.filter(
    (item) => item.roles === undefined || hasAnyRole(item.roles)
  );

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  }

  if (!isAuthenticated || profile === null) {
    return (
      <main className={styles.unauthenticated}>
        <ContentState
          status="error"
          title="Sua sessão não está disponível"
          description="Entre novamente para acessar o portal de atendimento."
        />
      </main>
    );
  }

  return (
    <div className={styles.shell} data-theme={theme}>
      <a className={styles.skipLink} href="#conteudo-principal">
        Pular para o conteúdo principal
      </a>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Infodive Service Desk — página inicial">
          <span className={styles.brandMark} aria-hidden="true">i</span>
          <span>Infodive <strong>Service Desk</strong></span>
        </a>
        <div className={styles.headerActions}>
          <button
            className={styles.iconButton}
            type="button"
            onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
            aria-label={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"}
            title={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"}
          >
            <span aria-hidden="true">{theme === "light" ? "◐" : "☀"}</span>
          </button>
          <details className={styles.accountMenu}>
            <summary aria-label="Abrir menu da conta">
              <span className={styles.avatar} aria-hidden="true">{profile.displayName.slice(0, 1).toUpperCase()}</span>
              <span className={styles.accountName}>{profile.displayName}</span>
            </summary>
            <div className={styles.accountPanel}>
              <strong>{profile.displayName}</strong>
              <span>{profile.email}</span>
              <span className={styles.tenantName}>{profile.tenantName}</span>
              <button type="button" onClick={handleSignOut} disabled={isSigningOut}>
                {isSigningOut ? "Saindo..." : "Sair"}
              </button>
            </div>
          </details>
        </div>
      </header>
      <div className={styles.body}>
        <aside className={styles.sidebar} aria-label="Navegação principal">
          <nav>
            <ul>
              {visibleNavigation.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    onClick={event => {
                      if (onNavigate && !event.ctrlKey && !event.metaKey &&
                          !event.altKey && !event.shiftKey) {
                        event.preventDefault();
                        onNavigate(item.href);
                      }
                    }}
                    aria-current={currentPath === item.href ? "page" : undefined}
                    title={item.description}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <main id="conteudo-principal" className={styles.main} tabIndex={-1}>
          <div className={styles.pageHeading}>
            <p>{profile.tenantName}</p>
            <h1>{pageTitle}</h1>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
