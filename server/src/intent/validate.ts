import type { IntentProposal, IntentResolution } from "./types";

const HELP_TEXT = [
  "I can help you with your loyalty points:",
  "• check your balance — e.g. \"balance\"",
  "• redeem points — e.g. \"redeem 100\"",
  "• gift points — e.g. \"gift 50 points to @alice\"",
].join("\n");

/** A points amount is valid only if it's a positive integer. */
function asPositiveInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

function asNonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function merchantSuffix(v: unknown): string {
  const m = asNonEmpty(v);
  return m ? ` from merchant ${m}` : "";
}

/**
 * The authority layer (our code, not the model). Turns an untrusted proposal
 * into a confirmation, a specific clarification, or help. A redeem/gift only
 * becomes a "confirm" when its required fields are structurally valid — so no
 * confirmation can describe a money action without a real points amount (and a
 * recipient, for gifts).
 */
export function validateIntent(proposal: IntentProposal): IntentResolution {
  switch (proposal.tool) {
    case "check_balance":
      return { kind: "confirm", reply: "Got it — you want to check your balance. (not executed yet)" };

    case "redeem_points": {
      const points = asPositiveInt(proposal.input.points);
      if (points === null) {
        return { kind: "clarify", reply: "How many points would you like to redeem? (e.g. \"redeem 100\")" };
      }
      return {
        kind: "confirm",
        reply: `Got it — you want to redeem ${points} points${merchantSuffix(proposal.input.merchantId)}. (not executed yet)`,
      };
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
      if (points === null) {
        return { kind: "clarify", reply: "How many points would you like to gift?" };
      }
      if (recipient === null) {
        return { kind: "clarify", reply: "Who should receive the points? (a Telegram @username)" };
      }
      return {
        kind: "confirm",
        reply: `Got it — you want to gift ${points} points to ${recipient}${merchantSuffix(proposal.input.merchantId)}. (not executed yet)`,
      };
    }

    case "help":
    default:
      return { kind: "help", reply: HELP_TEXT };
  }
}
