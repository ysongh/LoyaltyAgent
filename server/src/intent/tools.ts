import type Anthropic from "@anthropic-ai/sdk";

/**
 * The four intents the parser may propose. `required` is intentionally minimal:
 * the model is allowed to emit a structurally-incomplete money intent (e.g.
 * redeem_points with no points) so the validation layer can ask a specific
 * clarifying question — rather than forcing the model to choose between
 * fabricating a number and falling back to help.
 */
export const INTENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "check_balance",
    description: "The customer wants to know their current loyalty points balance.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "redeem_points",
    description:
      "The customer wants to redeem / cash out loyalty points (for USDC). Only set `points` to a clearly stated amount; never invent one.",
    input_schema: {
      type: "object",
      properties: {
        merchantId: { type: "string", description: "Merchant id, if the customer named one. Optional." },
        points: { type: "integer", description: "Number of points to redeem. Omit if not clearly stated." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "gift_points",
    description:
      "The customer wants to gift / send loyalty points to another person. Only set `points` and `recipient` to clearly stated values; never invent them.",
    input_schema: {
      type: "object",
      properties: {
        merchantId: { type: "string", description: "Merchant id, if the customer named one. Optional." },
        points: { type: "integer", description: "Number of points to gift. Omit if not clearly stated." },
        recipient: {
          type: "string",
          description: "Who receives the points — a Telegram username or @handle. Omit if not named.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "help",
    description:
      "Use for anything else: greetings, unclear/unparseable/off-topic messages, or any request whose required details can't be determined without guessing.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];
