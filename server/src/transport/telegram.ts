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

  constructor(private readonly token: string) {
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
        senderUsername: ctx.from.username,
      });
    });

    // Photo messages → download the highest-res variant and pass it as base64.
    this.bot.on("message:photo", async (ctx) => {
      const sizes = ctx.message.photo;
      const largest = sizes[sizes.length - 1]; // grammY orders ascending by size
      if (!largest) return;
      const file = await ctx.api.getFile(largest.file_id);
      if (!file.file_path) return;
      const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`);
      const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      await this.dispatch({
        userKey: String(ctx.from.id),
        text: ctx.message.caption ?? "",
        dedupeId: String(ctx.update.update_id),
        senderUsername: ctx.from.username,
        image: { base64, mimeType: "image/jpeg" }, // Telegram serves photos as JPEG
      });
    });

    // A .webp image often arrives as a (static) sticker. Animated/video stickers
    // (.tgs/.webm) aren't still images, so skip them.
    this.bot.on("message:sticker", async (ctx) => {
      const s = ctx.message.sticker;
      if (s.is_animated || s.is_video) return;
      const file = await ctx.api.getFile(s.file_id);
      if (!file.file_path) return;
      const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`);
      const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      await this.dispatch({
        userKey: String(ctx.from.id),
        text: "",
        dedupeId: String(ctx.update.update_id),
        senderUsername: ctx.from.username,
        image: { base64, mimeType: "image/webp" },
      });
    });

    // Image sent "as a file" (uncompressed) arrives as a document, not a photo.
    this.bot.on("message:document", async (ctx) => {
      const doc = ctx.message.document;
      if (!doc.mime_type?.startsWith("image/")) return; // ignore non-image files
      const file = await ctx.api.getFile(doc.file_id);
      if (!file.file_path) return;
      const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`);
      const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      await this.dispatch({
        userKey: String(ctx.from.id),
        text: ctx.message.caption ?? "",
        dedupeId: String(ctx.update.update_id),
        senderUsername: ctx.from.username,
        image: { base64, mimeType: doc.mime_type },
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
