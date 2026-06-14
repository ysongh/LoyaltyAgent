import Anthropic from "@anthropic-ai/sdk";
import { loadServerConfig } from "./config";
import { createServiceClient } from "./db/supabase";
import { Repo } from "./db/repo";
import { WalletProvisioner } from "./wallet";
import { makePublicClient } from "./chain/arc";
import { ChainExecutor } from "./chain/executor";
import { EnsResolver } from "./chain/ens";
import { AgentService } from "./agent/service";
import { ReceiptService } from "./receipts/service";
import { OnboardingCore } from "./core/onboarding";
import { TelegramTransport } from "./transport/telegram";
import { log } from "./log";

async function main() {
  const cfg = loadServerConfig();

  const sb = createServiceClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey);
  const repo = new Repo(sb);
  const provisioner = new WalletProvisioner(
    cfg.dynamicEnvironmentId,
    cfg.dynamicAuthToken,
    cfg.arcChainId,
    cfg.arcRpcUrl,
  );
  const anthropic = new Anthropic({ apiKey: cfg.anthropicApiKey });

  const publicClient = makePublicClient(cfg.arcChainId, cfg.arcRpcUrl);
  const executor = new ChainExecutor(
    publicClient,
    provisioner,
    cfg.loyaltyPointsAddress,
    cfg.merchantEscrowAddress,
  );

  const transport = new TelegramTransport(cfg.telegramBotToken);

  // Stage 4 brain for known customers (confirm → execute). Uses the transport
  // only as a Replier; the core stays free of grammY/Anthropic types.
  // ENS resolution runs on a SEPARATE mainnet client (chainId 1); Arc can't resolve ENS.
  const ens = new EnsResolver(cfg.mainnetRpcUrl);

  const agent = new AgentService({
    repo,
    executor,
    anthropic,
    replier: transport,
    merchantId: cfg.demoMerchantId,
    ens,
    pendingTtlMs: cfg.pendingTtlMs,
  });

  // Photo-receipt path (parallel to signed-QR; no crypto proof, immediate credit).
  const receipts = new ReceiptService({
    repo,
    executor,
    provisioner,
    anthropic,
    replier: transport,
    merchantId: cfg.demoMerchantId,
    maxReceiptTotal: cfg.maxReceiptTotal,
    maxPointsPerReceipt: cfg.maxPointsPerReceipt,
    maxPointsPerDay: cfg.maxPointsPerDay,
  });

  const core = new OnboardingCore({
    repo,
    provisioner,
    replier: transport,
    chainId: cfg.arcChainId,
    handleCustomerMessage: (msg) => agent.handle(msg),
    handlePhoto: (msg) => receipts.handle(msg),
  });

  // Telegram adapter → OnboardingCore → reply. The core only receives InboundMessage.
  transport.onMessage((msg) => core.handle(msg));

  await transport.start();
  log.info("Stage 4 agent bot running. Ctrl-C to stop.");

  const shutdown = async () => {
    log.info("shutting down…");
    await transport.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("fatal", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
