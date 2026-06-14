import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Address } from "viem";
import type { InboundMessage, Replier } from "../transport/types";
import type { Repo, SigningWallet } from "../db/repo";
import type { ChainExecutor } from "../chain/executor";
import type { WalletProvisioner } from "../wallet";
import { extractReceipt } from "./vision";
import { txUrl } from "../chain/arc";
import { log } from "../log";

const DAY_MS = 24 * 60 * 60 * 1000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface ReceiptDeps {
  repo: Repo;
  executor: ChainExecutor;
  provisioner: WalletProvisioner;
  anthropic: Anthropic;
  replier: Replier;
  merchantId: number;
  maxReceiptTotal: number;
  maxPointsPerReceipt: number;
  maxPointsPerDay: number;
}

/**
 * Photo-receipt onboarding/credit path. ⚠️ UNLIKE the signed-QR path, a photo
 * carries NO cryptographic proof, and (per an explicit demo decision) it credits
 * IMMEDIATELY with NO confirm gate. The fraud controls here — image dedupe,
 * content dedupe, per-receipt cap, per-user daily cap — are therefore the ONLY
 * abuse defense on this path. A photo also ONBOARDS an unknown user (creates the
 * customer + wallet, then mints) — the frictionless story.
 */
export class ReceiptService {
  constructor(private readonly d: ReceiptDeps) {}

  async handle(msg: InboundMessage): Promise<void> {
    if (!msg.image) return;
    await this.d.replier.reply(msg.userKey, "📸 Reading your receipt…");
    void this.process(msg); // ack fast, settle async (don't hold the handler open)
  }

  private async process(msg: InboundMessage): Promise<void> {
    const reply = (t: string) => this.d.replier.reply(msg.userKey, t);
    try {
      const image = msg.image!;

      // 1) Vision extraction (untrusted).
      const r = await extractReceipt(this.d.anthropic, image.base64, image.mimeType);
      if (!r) return void (await reply("Couldn't read that receipt — please try a clearer photo."));

      // 2) Plausibility + caps (re-derived, not trusted from the model).
      if (!(r.total > 0)) {
        return void (await reply("I couldn't find a valid total on that — please try a clearer photo of the receipt."));
      }
      if (r.total > this.d.maxReceiptTotal) {
        return void (await reply(`That total ($${r.total.toFixed(2)}) is above the $${this.d.maxReceiptTotal} limit for photo receipts.`));
      }
      const points = BigInt(Math.floor(r.total)); // 1 point per $1, floored
      if (points <= 0n) {
        return void (await reply("That receipt is under $1, so there's nothing to credit."));
      }
      if (points > BigInt(this.d.maxPointsPerReceipt)) {
        return void (await reply(`That's over the ${this.d.maxPointsPerReceipt}-point cap for a single receipt.`));
      }

      // 3) Fraud controls — the entire defense on this path.
      const imageHash = sha256(image.base64);
      const contentHash = sha256(
        `${r.merchant.trim().toLowerCase()}|${r.date.trim()}|${r.total.toFixed(2)}`,
      );
      if (await this.d.repo.hasReceiptImage(imageHash)) {
        return void (await reply("You've already credited this exact receipt photo."));
      }
      if (await this.d.repo.hasReceiptContent(contentHash)) {
        return void (await reply("This receipt has already been claimed."));
      }
      if (!r.looksGenuine) {
        log.warn("receipt flagged but credited (demo: no confirm gate)", {
          merchant: r.merchant,
          tamperConcerns: r.tamperConcerns,
        });
      }

      // 4) Create-or-lookup customer — a photo onboards an unknown user.
      const customer = await this.resolveOrOnboard(msg);
      if (!customer.wallet) return void (await reply("Couldn't set up your wallet — please try again."));

      // 5) Per-user daily cap (rolling 24h).
      const since = new Date(Date.now() - DAY_MS).toISOString();
      const today = await this.d.repo.sumReceiptPointsSince(customer.userKey, since);
      if (today + points > BigInt(this.d.maxPointsPerDay)) {
        return void (await reply(
          `That would put you over the daily limit of ${this.d.maxPointsPerDay} points from photo receipts. Try again tomorrow.`,
        ));
      }

      // 6) Reserve the claim (atomic dedupe backstop via unique hashes).
      const claimId = await this.d.repo.reserveReceiptClaim({
        userKey: customer.userKey,
        imageHash,
        contentHash,
        merchant: r.merchant,
        total: r.total,
        points,
      });
      if (!claimId) return void (await reply("This receipt has already been claimed."));

      // 7) Credit immediately — operator mints to the customer (Stage 4 path).
      let txHash: `0x${string}`;
      try {
        txHash = await this.d.executor.mint(
          await this.operatorSigner(),
          this.d.merchantId,
          customer.wallet,
          points,
        );
      } catch (e) {
        await this.d.repo.deleteReceiptClaim(claimId); // free the receipt to retry
        log.error("receipt mint failed", { message: e instanceof Error ? e.message : String(e) });
        return void (await reply("Couldn't credit your points just now — please try again."));
      }
      await this.d.repo.setReceiptClaimTx(claimId, txHash);

      const who = r.merchant.trim() || "that merchant";
      await reply(`✅ Earned ${points} points from ${who} ($${r.total.toFixed(2)}).\n${txUrl(txHash)}`);
    } catch (err) {
      log.error("receipt processing failed", { message: err instanceof Error ? err.message : String(err) });
      await reply("Something went wrong reading that receipt — please try again.");
    }
  }

  private async resolveOrOnboard(
    msg: InboundMessage,
  ): Promise<{ userKey: string; wallet: Address | null }> {
    const existing = await this.d.repo.getCustomerByTelegram(msg.userKey);
    if (existing?.wallet_address) {
      if (msg.senderUsername) {
        this.d.repo.setCustomerUsername(msg.userKey, msg.senderUsername).catch(() => {});
      }
      return { userKey: existing.user_key, wallet: existing.wallet_address as Address };
    }
    // Onboard: a photo IS the onboarding for a new user.
    const w = await this.d.provisioner.provision();
    const created = await this.d.repo.createCustomerWithWallet({
      telegramUserId: msg.userKey,
      walletAddress: w.address,
      walletMetadata: w.walletMetadata,
      shares: w.shares,
    });
    if (msg.senderUsername) {
      this.d.repo.setCustomerUsername(msg.userKey, msg.senderUsername).catch(() => {});
    }
    log.info("onboarded customer via photo receipt", { userKey: created.user_key, walletAddress: w.address });
    return { userKey: created.user_key, wallet: w.address as Address };
  }

  private async operatorSigner(): Promise<SigningWallet> {
    const op = await this.d.repo.getOperatorWallet("primary");
    if (!op) throw new Error("operator wallet not provisioned");
    return {
      userKey: "operator",
      address: op.wallet_address,
      walletMetadata: op.wallet_metadata,
      shares: op.shares,
    };
  }
}
