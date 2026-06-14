import type Anthropic from "@anthropic-ai/sdk";
import { parseIntent } from "./parser";
import { validateIntent } from "./validate";
import { log } from "../log";

/** A transport/SDK-agnostic intent resolver: text in, reply string out. */
export type IntentResolver = (text: string) => Promise<string>;

/**
 * Compose parse -> log proposal -> validate -> log resolution -> reply.
 * Logging the proposal is safe: it is a *proposal only*, never executed here.
 * This is the seam the core depends on — the core never imports Anthropic.
 */
export function createIntentResolver(client: Anthropic): IntentResolver {
  return async (text: string): Promise<string> => {
    const proposal = await parseIntent(client, text);
    log.info("intent proposal (parsed, NOT executed)", {
      tool: proposal.tool,
      input: proposal.input,
    });

    const resolution = validateIntent(proposal);
    log.info("intent resolution", { kind: resolution.kind, tool: proposal.tool });

    return resolution.reply;
  };
}
