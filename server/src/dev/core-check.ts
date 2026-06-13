/**
 * Offline proof of the core + transport seam — no Telegram, no bot token.
 *
 * Feeds hand-built {@link InboundMessage}s (the exact normalized shape any
 * transport must produce) through {@link EchoCore} with a mock {@link Replier},
 * and checks the replies. This demonstrates the core needs ONLY the normalized
 * shape — there is no grammY import anywhere in its dependency graph.
 */
import { EchoCore } from "../core/echo";
import type { InboundMessage, Replier } from "../transport/types";

const sent: Array<{ userKey: string; text: string }> = [];
const mockReplier: Replier = {
  async reply(userKey, text) {
    sent.push({ userKey, text });
  },
};

async function run() {
  const core = new EchoCore(mockReplier);

  const textMsg: InboundMessage = {
    userKey: "42",
    text: "hello world",
    dedupeId: "update:1",
  };
  const startMsg: InboundMessage = {
    userKey: "42",
    text: "/start testpayload123",
    dedupeId: "update:2",
    startPayload: "testpayload123",
  };

  await core.handle(textMsg);
  await core.handle(startMsg);

  console.log("replies:", sent);

  const ok =
    sent.length === 2 &&
    sent[0]?.text === "echo: hello world" &&
    sent[1]?.text === "onboard payload: testpayload123";

  console.log(ok ? "✓ core behaves as expected" : "✗ unexpected replies");
  process.exit(ok ? 0 : 1);
}

run();
