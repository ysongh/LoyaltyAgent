import type { InboundMessage, Replier } from "../transport/types";

/**
 * Stub core for Stage 1. Echoes input back to prove the
 * transport → core → reply plumbing and deep-link onboarding.
 *
 * Deliberately knows nothing about identity, Supabase, chain calls, or Claude —
 * and nothing about which transport delivered the message. It depends only on
 * the normalized {@link InboundMessage} shape and a {@link Replier}.
 */
export class EchoCore {
  constructor(private readonly replier: Replier) {}

  async handle(msg: InboundMessage): Promise<void> {
    if (msg.startPayload !== undefined) {
      await this.replier.reply(msg.userKey, `onboard payload: ${msg.startPayload}`);
      return;
    }
    await this.replier.reply(msg.userKey, `echo: ${msg.text}`);
  }
}
