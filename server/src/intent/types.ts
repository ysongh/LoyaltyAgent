/**
 * Intent types — pure data, no Anthropic/grammY imports. The core depends only
 * on the resolver function signature, never on these or on the SDK.
 */

export type IntentTool = "check_balance" | "redeem_points" | "gift_points" | "help";

/**
 * The raw proposal extracted from a Claude tool_use block. Loosely typed on
 * purpose: the model's output is UNTRUSTED — the validation layer (our code) is
 * the authority that decides whether it's actionable.
 */
export interface IntentProposal {
  tool: string;
  input: Record<string, unknown>;
}

/** Outcome of validating a proposal. The core only ever sends `reply`. */
export type IntentResolution =
  | { kind: "confirm"; reply: string }
  | { kind: "clarify"; reply: string }
  | { kind: "help"; reply: string };
