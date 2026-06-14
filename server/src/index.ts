import { loadServerConfig } from "./config";
import { createServiceClient } from "./db/supabase";
import { Repo } from "./db/repo";
import { WalletProvisioner } from "./wallet";
import { OnboardingCore } from "./core/onboarding";
import { TelegramTransport } from "./transport/telegram";
import { log } from "./log";

async function main() {
  const cfg = loadServerConfig();

  const sb = createServiceClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey);
  const repo = new Repo(sb);
  const provisioner = new WalletProvisioner(cfg.dynamicEnvironmentId, cfg.dynamicAuthToken);

  const transport = new TelegramTransport(cfg.telegramBotToken);
  const core = new OnboardingCore({
    repo,
    provisioner,
    replier: transport, // core sees the transport only as a Replier
    chainId: cfg.arcChainId,
  });

  // Telegram adapter → OnboardingCore → reply. The core only receives InboundMessage.
  transport.onMessage((msg) => core.handle(msg));

  await transport.start();
  log.info("Stage 2 onboarding bot running. Ctrl-C to stop.");

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
