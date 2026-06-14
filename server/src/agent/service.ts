import type Anthropic from "@anthropic-ai/sdk";
import { formatEther, type Address } from "viem";
import type { InboundMessage, Replier } from "../transport/types";
import type { Repo } from "../db/repo";
import type { ChainExecutor } from "../chain/executor";
import { parseIntent } from "../intent/parser";
import { interpretIntent } from "../intent/validate";
import { PendingStore, type PendingAction } from "./pending";
import { txUrl } from "../chain/arc";
import { log } from "../log";

const AFFIRM = new Set(["yes", "y", "yeah", "yep", "yup", "confirm", "ok", "okay", "sure"]);
const DENY = new Set(["no", "n", "nope", "cancel", "stop", "nevermind", "never mind"]);

const norm = (t: string) => t.trim().toLowerCase().replace(/[!.?,]/g, "");

export interface AgentDeps {
  repo: Repo;
  executor: ChainExecutor;
  anthropic: Anthropic;
  replier: Replier;
  merchantId: number;
  /** Pending-action TTL in ms (default 5 min). */
  pendingTtlMs?: number;
}

/**
 * Stage 4 brain for a KNOWN customer's message. Confirm-then-execute gate:
 * redeem/gift produce a summary + a 5-min pending action; a following YES executes
 * (ack fast, settle async); NO or any other message clears it. ALL money facts are
 * re-derived from on-chain/DB state at confirm AND at execution — never trusted
 * from the parse. check_balance is a read, executed immediately.
 */
export class AgentService {
  private readonly pending: PendingStore;
  private business?: string;

  constructor(private readonly deps: AgentDeps) {
    this.pending = new PendingStore(deps.pendingTtlMs);
  }

  async handle(msg: InboundMessage): Promise<void> {
    // Learn the customer's @handle so gifts can resolve them as a recipient.
    if (msg.senderUsername) {
      this.deps.repo.setCustomerUsername(msg.userKey, msg.senderUsername).catch((e) =>
        log.warn("username update failed", { message: String(e) }),
      );
    }

    const pending = this.pending.get(msg.userKey);
    if (pending) {
      const n = norm(msg.text);
      if (AFFIRM.has(n)) {
        await this.execute(msg.userKey);
        return;
      }
      // NO, or any other message, clears the pending action.
      this.pending.clear(msg.userKey);
      if (DENY.has(n)) {
        await this.deps.replier.reply(msg.userKey, "Okay, cancelled.");
        return;
      }
      // fall through: treat this message as a fresh request.
    }

    const proposal = await parseIntent(this.deps.anthropic, msg.text);
    log.info("intent proposal (parsed, NOT executed)", { tool: proposal.tool, input: proposal.input });
    const intent = interpretIntent(proposal);

    switch (intent.kind) {
      case "help":
      case "clarify":
        await this.deps.replier.reply(msg.userKey, intent.reply);
        return;
      case "balance":
        await this.handleBalance(msg.userKey);
        return;
      case "redeem":
        await this.confirmRedeem(msg.userKey, BigInt(intent.points));
        return;
      case "gift":
        await this.confirmGift(msg.userKey, BigInt(intent.points), intent.recipient);
        return;
    }
  }

  // --- read ---

  private async handleBalance(userKey: string): Promise<void> {
    const addr = await this.customerAddress(userKey);
    if (!addr) return this.reply(userKey, "Your wallet isn't set up yet.");
    const bal = await this.deps.executor.pointsBalance(addr, this.deps.merchantId);
    await this.reply(userKey, `You have ${bal} points with ${await this.businessName()}.`);
  }

  // --- confirm (re-derive money facts; reject here, no pending leftover) ---

  private async confirmRedeem(userKey: string, points: bigint): Promise<void> {
    const addr = await this.customerAddress(userKey);
    if (!addr) return this.reply(userKey, "Your wallet isn't set up yet.");

    const balance = await this.deps.executor.pointsBalance(addr, this.deps.merchantId);
    if (points > balance) {
      return this.reply(userKey, `You have ${balance} points, so you can't redeem ${points}.`);
    }
    const rate = await this.deps.executor.ratePerPoint(this.deps.merchantId);
    if (rate === 0n) return this.reply(userKey, "Redemption isn't available right now.");
    const usdcOut = points * rate;
    const pool = await this.deps.executor.escrowBalance(this.deps.merchantId);
    if (usdcOut > pool) return this.reply(userKey, "The reward pool is too low to cover that right now.");

    this.pending.set(userKey, {
      type: "redeem",
      points,
      merchantId: this.deps.merchantId,
      business: await this.businessName(),
      usdcOut,
    });
    await this.reply(
      userKey,
      `Redeem ${points} points for ${formatEther(usdcOut)} USDC? Reply YES to confirm, NO to cancel.`,
    );
  }

  private async confirmGift(userKey: string, points: bigint, recipientRaw: string): Promise<void> {
    const senderAddr = await this.customerAddress(userKey);
    if (!senderAddr) return this.reply(userKey, "Your wallet isn't set up yet.");

    const recipient = await this.deps.repo.getCustomerByUsername(recipientRaw);
    const handle = recipientRaw.replace(/^@/, "");
    if (!recipient?.wallet_address) {
      return this.reply(userKey, `@${handle} needs to scan a receipt first before you can gift them.`);
    }
    if (recipient.wallet_address.toLowerCase() === senderAddr.toLowerCase()) {
      return this.reply(userKey, "You can't gift points to yourself.");
    }
    const balance = await this.deps.executor.pointsBalance(senderAddr, this.deps.merchantId);
    if (points > balance) {
      return this.reply(userKey, `You have ${balance} points, so you can't gift ${points}.`);
    }

    const business = await this.businessName();
    this.pending.set(userKey, {
      type: "gift",
      points,
      merchantId: this.deps.merchantId,
      business,
      recipientHandle: handle,
      recipientAddress: recipient.wallet_address as Address,
    });
    await this.reply(
      userKey,
      `Gift ${points} points to @${handle} at ${business}? Reply YES to confirm, NO to cancel.`,
    );
  }

  // --- execute (ack fast, settle async, at-most-once) ---

  private async execute(userKey: string): Promise<void> {
    const action = this.pending.claim(userKey); // atomic; a duplicate YES gets null
    if (!action) return;
    await this.reply(userKey, "Processing…");
    void this.settle(userKey, action); // do NOT hold the handler open through settlement
  }

  private async settle(userKey: string, action: PendingAction): Promise<void> {
    try {
      const signer = await this.deps.repo.getCustomerSigningWallet(userKey);
      if (!signer) throw new Error("signing wallet unavailable");

      // Re-derive authoritative balance just before signing.
      const balance = await this.deps.executor.pointsBalance(signer.address as Address, action.merchantId);
      if (action.points > balance) {
        await this.reply(userKey, `Your balance changed — you now have ${balance} points, so I didn't run that.`);
        return;
      }

      if (action.type === "redeem") {
        const rate = await this.deps.executor.ratePerPoint(action.merchantId);
        if (rate === 0n) return void (await this.reply(userKey, "Redemption isn't available right now."));
        const usdcOut = action.points * rate;
        const pool = await this.deps.executor.escrowBalance(action.merchantId);
        if (usdcOut > pool) {
          return void (await this.reply(userKey, "The reward pool is too low to cover that right now."));
        }
        const hash = await this.deps.executor.redeem(signer, action.merchantId, action.points);
        await this.reply(
          userKey,
          `✅ Redeemed ${action.points} points for ${formatEther(usdcOut)} USDC.\n${txUrl(hash)}`,
        );
        return;
      }

      // gift — re-resolve recipient at execution time too.
      const recipient = await this.deps.repo.getCustomerByUsername(action.recipientHandle ?? "");
      if (!recipient?.wallet_address) {
        await this.reply(userKey, `@${action.recipientHandle} is no longer available to receive points.`);
        return;
      }
      const hash = await this.deps.executor.gift(
        signer,
        action.merchantId,
        action.points,
        recipient.wallet_address as Address,
      );
      await this.reply(
        userKey,
        `✅ Gifted ${action.points} points to @${action.recipientHandle} at ${action.business}.\n${txUrl(hash)}`,
      );
    } catch (err) {
      log.error("execution failed", { type: action.type, message: err instanceof Error ? err.message : String(err) });
      await this.reply(userKey, "Something went wrong and nothing was changed. Please try again.");
    } finally {
      this.pending.clear(userKey); // consume
    }
  }

  // --- helpers ---

  private async customerAddress(userKey: string): Promise<Address | null> {
    const c = await this.deps.repo.getCustomerByTelegram(userKey);
    return (c?.wallet_address as Address | undefined) ?? null;
  }

  private async businessName(): Promise<string> {
    if (this.business) return this.business;
    const m = await this.deps.repo.getMerchant(this.deps.merchantId);
    this.business = m?.name ?? `merchant #${this.deps.merchantId}`;
    return this.business;
  }

  private async reply(userKey: string, text: string): Promise<void> {
    await this.deps.replier.reply(userKey, text);
  }
}
