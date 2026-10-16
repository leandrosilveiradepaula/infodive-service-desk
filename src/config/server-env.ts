import { ValidationError } from "../shared/errors";

export type NodeEnvironment = "development" | "test" | "production";

export interface ServerEnvironment {
  readonly nodeEnv: NodeEnvironment;
  readonly supabaseUrl: string;
  readonly supabaseServiceRoleKey: string;
}

export interface PublicRuntimeConfig {
  readonly nodeEnv: NodeEnvironment;
}

type EnvironmentSource = Record<string, string | undefined>;

const supportedNodeEnvironments = new Set<NodeEnvironment>([
  "development",
  "test",
  "production"
]);

function requiredValue(source: EnvironmentSource, key: string, issues: string[]): string {
  const value = source[key]?.trim();

  if (value === undefined || value.length === 0) {
    issues.push(`${key} is required`);
    return "";
  }

  return value;
}

function validateHttpUrl(value: string, key: string, issues: string[]): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      issues.push(`${key} must use http or https`);
    }
  } catch {
    issues.push(`${key} must be a valid URL`);
  }
}

/**
 * Validates server-only configuration. Do not import this module from browser code.
 */
export function loadServerEnvironment(source: EnvironmentSource = process.env): ServerEnvironment {
  const issues: string[] = [];
  const nodeEnvValue = source.NODE_ENV?.trim() || "development";

  if (!supportedNodeEnvironments.has(nodeEnvValue as NodeEnvironment)) {
    issues.push("NODE_ENV must be development, test, or production");
  }

  const supabaseUrl = requiredValue(source, "SUPABASE_URL", issues);
  const supabaseServiceRoleKey = requiredValue(source, "SUPABASE_SERVICE_ROLE_KEY", issues);

  if (supabaseUrl.length > 0) {
    validateHttpUrl(supabaseUrl, "SUPABASE_URL", issues);
  }

  if (issues.length > 0) {
    throw new ValidationError("Invalid server environment.", { issues });
  }

  return {
    nodeEnv: nodeEnvValue as NodeEnvironment,
    supabaseUrl,
    supabaseServiceRoleKey
  };
}

/** Returns the only environment value that may be safely sent to a client. */
export function toPublicRuntimeConfig(environment: ServerEnvironment): PublicRuntimeConfig {
  return { nodeEnv: environment.nodeEnv };
}
