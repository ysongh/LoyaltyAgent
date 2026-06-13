/**
 * The transport seam.
 *
 * The core depends ONLY on the types in this file — never on grammY, Twilio, or
 * any transport SDK. Adding SMS later means writing another `Transport`
 * implementation; the core does not change.
 */

/** A transport-agnostic inbound message — the only shape the core ever sees. */
export interface InboundMessage {
  /** Stable per-user id within the transport (Telegram `from.id`; later an SMS phone number). */
  userKey: string;
  /** The message text. Empty string for a bare `/start` with no payload. */
  text: string;
  /** Transport-unique id for this delivery, usable for idempotency (Telegram `update_id`). */
  dedupeId: string;
  /** Deep-link onboarding payload from `/start <payload>`; `undefined` for normal messages. */
  startPayload?: string;
}

/** Anything that can send a text reply, addressed by the same `userKey` carried inbound. */
export interface Replier {
  reply(userKey: string, text: string): Promise<void>;
}

/** The single handler a transport pushes normalized inbound messages to. */
export type MessageHandler = (msg: InboundMessage) => Promise<void> | void;

/** A transport normalizes inbound messages to {@link InboundMessage} and can reply. */
export interface Transport extends Replier {
  /** Register the handler that receives normalized inbound messages. */
  onMessage(handler: MessageHandler): void;
  /** Begin receiving messages (e.g. start long-polling). */
  start(): Promise<void>;
  /** Stop receiving messages and release resources. */
  stop(): Promise<void>;
}
