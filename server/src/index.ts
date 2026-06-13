import "dotenv/config";
import { EchoCore } from "./core/echo";
import { TelegramTransport } from "./transport/telegram";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var ${name} (see server/.env.example)`);
  }
  return v.trim();
}

async function main() {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");

  const transport = new TelegramTransport(token);
  const core = new EchoCore(transport); // core sees the transport only as a Replier

  // Telegram adapter → EchoCore → reply. The core only ever receives InboundMessage.
  transport.onMessage((msg) => {
    console.log("[core] received normalized message:", msg);
    return core.handle(msg);
  });

  await transport.start();
  console.log("[server] Stage 1 echo bot running. Ctrl-C to stop.");

  const shutdown = async () => {
    console.log("\n[server] shutting down…");
    await transport.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
