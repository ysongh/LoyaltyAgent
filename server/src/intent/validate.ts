import type { IntentProposal, IntentResolution } from "./types";

const HELP_TEXT = [
  "I can help you with your loyalty points:",
  "• check your balance — e.g. \"balance\"",
  "• redeem points — e.g. \"redeem 100\"",
  "• gift points — e.g. \"gift 50 points to @alice\"",
].join("\n");

/** A points amount is valid only if it's a positive integer. */
export function asPositiveInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

export function asNonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Structured interpretation of a proposal (Stage 4). The model's numbers are
 * still untrusted — this only confirms STRUCTURE (positive-int points, present
 * recipient). Affordability / recipient existence / merchant validity are
 * re-derived from authoritative state later, never here.
 */
export type InterpretedIntent =
  | { kind: "balance" }
  | { kind: "redeem"; points: number }
  | { kind: "gift"; points: number; recipient: string }
  | { kind: "clarify"; reply: string }
  | { kind: "help"; reply: string };

export function interpretIntent(proposal: IntentProposal): InterpretedIntent {
  switch (proposal.tool) {
    case "check_balance":
      return { kind: "balance" };

    case "redeem_points": {
      const points = asPositiveInt(proposal.input.points);
      if (points === null) {
        return { kind: "clarify", reply: "How many points would you like to redeem? (e.g. \"redeem 100\")" };
      }
      return { kind: "redeem", points };
    }

    case "gift_points": {
      const points = asPositiveInt(proposal.input.points);
      const recipient = asNonEmpty(proposal.input.recipient);
      if (points === null && recipient === null) {
        return {
          kind: "clarify",
          reply: "Who would you like to gift points to, and how many? (e.g. \"gift 50 points to @alice\")",
        };
      }
      if (points === null) return { kind: "clarify", reply: "How many points would you like to gift?" };
      if (recipient === null) {
        return { kind: "clarify", reply: "Who should receive the points? (a Telegram @username)" };
      }
      return { kind: "gift", points, recipient };
    }

    case "help":
    default:
      return { kind: "help", reply: HELP_TEXT };
  }
}

/**
 * Stage 3 string renderer (propose-only). Kept for the adversarial test and as
 * the no-execution path. Stage 4 uses {@link interpretIntent} instead and then
 * re-derives money facts before acting.
 */
export function validateIntent(proposal: IntentProposal): IntentResolution {
  const i = interpretIntent(proposal);
  switch (i.kind) {
    case "balance":
      return { kind: "confirm", reply: "Got it — you want to check your balance. (not executed yet)" };
    case "redeem":
      return { kind: "confirm", reply: `Got it — you want to redeem ${i.points} points. (not executed yet)` };
    case "gift":
      return {
        kind: "confirm",
        reply: `Got it — you want to gift ${i.points} points to ${i.recipient}. (not executed yet)`,
      };
    case "clarify":
      return { kind: "clarify", reply: i.reply };
    case "help":
      return { kind: "help", reply: i.reply };
  }
}
