import "dotenv/config";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var ${name} (see server/.env.example)`);
  }
  return v.trim();
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return n;
}

/** Runtime config for the agent server. Secrets are read from env, never hardcoded. */
export interface ServerConfig {
  telegramBotToken: string;
  dynamicEnvironmentId: string;
  dynamicAuthToken: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /** Arc chain id — used as the EIP-712 domain chainId for receipt verification. */
  arcChainId: number;
}

export function loadServerConfig(): ServerConfig {
  return {
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    dynamicEnvironmentId: requireEnv("DYNAMIC_ENVIRONMENT_ID"),
    dynamicAuthToken: requireEnv("DYNAMIC_AUTH_TOKEN"),
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    arcChainId: intEnv("ARC_CHAIN_ID", 5042002),
  };
}
