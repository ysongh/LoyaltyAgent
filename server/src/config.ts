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
  /** Anthropic API key for the Stage 3 intent parser. */
  anthropicApiKey: string;
  /** Arc RPC endpoint for on-chain reads/writes (Stage 4). */
  arcRpcUrl: string;
  /** Deployed LoyaltyPoints (ERC-1155) address. */
  loyaltyPointsAddress: `0x${string}`;
  /** Deployed MerchantEscrow address (native-USDC payout). */
  merchantEscrowAddress: `0x${string}`;
  /** Single-merchant demo: the merchant id to pin on-chain actions to. */
  demoMerchantId: number;
  /** Confirm-then-execute pending TTL in ms (default 5 min). */
  pendingTtlMs: number;
  /** Photo-receipt path: reject totals above this (sane cap). */
  maxReceiptTotal: number;
  /** Photo-receipt path: max points credited per single receipt. */
  maxPointsPerReceipt: number;
  /** Photo-receipt path: max points per user per rolling 24h. */
  maxPointsPerDay: number;
  /** Ethereum MAINNET RPC — used ONLY for live ENS resolution (never for Arc txs). */
  mainnetRpcUrl: string;
}

function addrEnv(name: string): `0x${string}` {
  const v = requireEnv(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`${name} must be a 0x-prefixed 20-byte address, got "${v}"`);
  }
  return v as `0x${string}`;
}

export function loadServerConfig(): ServerConfig {
  return {
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    dynamicEnvironmentId: requireEnv("DYNAMIC_ENVIRONMENT_ID"),
    dynamicAuthToken: requireEnv("DYNAMIC_AUTH_TOKEN"),
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    arcChainId: intEnv("ARC_CHAIN_ID", 5042002),
    anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
    arcRpcUrl: process.env.ARC_TESTNET_RPC_URL?.trim() || "https://rpc.testnet.arc.network",
    loyaltyPointsAddress: addrEnv("LOYALTY_POINTS_ADDRESS"),
    merchantEscrowAddress: addrEnv("MERCHANT_ESCROW_ADDRESS"),
    demoMerchantId: intEnv("DEMO_MERCHANT_ID", 1),
    pendingTtlMs: intEnv("PENDING_TTL_MS", 5 * 60_000),
    maxReceiptTotal: intEnv("MAX_RECEIPT_TOTAL", 1000),
    maxPointsPerReceipt: intEnv("MAX_POINTS_PER_RECEIPT", 500),
    maxPointsPerDay: intEnv("MAX_POINTS_PER_DAY", 1000),
    mainnetRpcUrl: process.env.MAINNET_RPC_URL?.trim() || "https://ethereum-rpc.publicnode.com",
  };
}
