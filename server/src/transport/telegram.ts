import { Bot } from "grammy";
import type { InboundMessage, MessageHandler, Transport } from "./types";

/**
 * Telegram transport (grammY, long-polling). The ONLY file in the service that
 * imports grammY — it translates Telegram updates into {@link InboundMessage}
 * and sends replies via `userKey`.
 *
 * Note: `userKey` is the Telegram `from.id`. In private (1:1) chats — the only
 * mode Stage 1 targets — `from.id === chat.id`, so replying to `userKey` reaches
 * the same user. Group/channel routing is out of scope here.
 */
export class TelegramTransport implements Transport {
  private readonly bot: Bot;
  private handler?: MessageHandler;

  constructor(token: string) {
    this.bot = new Bot(token);
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async reply(userKey: string, text: string): Promise<void> {
    await this.bot.api.sendMessage(userKey, text);
  }

  async start(): Promise<void> {
    // `/start <payload>` deep-link. Registered BEFORE the text handler: grammY
    // runs matching handlers in order and `command` does not call `next()`, so a
    // `/start` update is consumed here and not also echoed as plain text.
    this.bot.command("start", async (ctx) => {
      if (!ctx.from) return;
      await this.dispatch({
        userKey: String(ctx.from.id),
        text: ctx.message?.text ?? "",
        dedupeId: String(ctx.update.update_id),
        startPayload: ctx.match, // text after "/start"; "" when none provided
      });
    });

    // Plain text messages (everything except the `/start` consumed above).
    this.bot.on("message:text", async (ctx) => {
      await this.dispatch({
        userKey: String(ctx.from.id),
        text: ctx.message.text,
        dedupeId: String(ctx.update.update_id),
      });
    });

    this.bot.catch((err) => console.error("[telegram] error:", err));

    // bot.start() resolves only when the bot stops, so we intentionally don't await it.
    void this.bot.start({
      onStart: (info) => console.log(`[telegram] long-polling as @${info.username}`),
    });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  private async dispatch(msg: InboundMessage): Promise<void> {
    if (!this.handler) return;
    await this.handler(msg);
  }
}
