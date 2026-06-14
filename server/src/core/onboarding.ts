import type { Address } from "viem";
import type { InboundMessage, Replier } from "../transport/types";
import type { Repo } from "../db/repo";
import type { WalletProvisioner } from "../wallet";
import { verifyReceiptSignature } from "../receipt";
import { log } from "../log";

/** Handles a known customer's free-text message (Stage 4 agent brain). */
export type CustomerMessageHandler = (msg: InboundMessage) => Promise<void>;

const COLD_REPLY = "Scan a receipt to get started.";
const INVALID_REPLY =
  "That link is invalid or has already been used. Please scan a new receipt.";
const BAD_SIG_REPLY = "Couldn't verify that receipt. Please scan again.";

export interface OnboardingDeps {
  repo: Repo;
  provisioner: WalletProvisioner;
  replier: Replier;
  /** EIP-712 domain chainId (Arc = 5042002). */
  chainId: number;
  /** Handles a known customer's free-text message (Stage 4: parse → confirm → execute). */
  handleCustomerMessage: CustomerMessageHandler;
}

/**
 * Stage 2 core: turns `/start <token>` into a verified customer with a provisioned
 * Dynamic wallet. No minting, no balance reads, no Claude — pure identity/wallet
 * provisioning. Depends only on the transport seam (InboundMessage/Replier),
 * never on grammY.
 */
export class OnboardingCore {
  /** In-memory dedupe of transport deliveries so a re-delivered update_id can't double-run. */
  private readonly seen = new Set<string>();

  constructor(private readonly deps: OnboardingDeps) {}

  async handle(msg: InboundMessage): Promise<void> {
    if (this.seen.has(msg.dedupeId)) {
      log.info("ignoring duplicate update", { dedupeId: msg.dedupeId });
      return;
    }
    this.seen.add(msg.dedupeId);

    const token = msg.startPayload?.trim();
    if (token) {
      await this.onboard(msg.userKey, token);
      return;
    }

    // Bare /start (startPayload === "") → onboarding entry point, never intent.
    if (msg.startPayload !== undefined) {
      await this.deps.replier.reply(msg.userKey, COLD_REPLY);
      return;
    }

    // Plain free-text message. Unknown users get the cold reply (no wallet, no
    // parsing). Known customers go through the Stage 3 intent parser — which only
    // PROPOSES an intent; nothing is executed.
    const customer = await this.deps.repo.getCustomerByTelegram(msg.userKey);
    if (!customer) {
      await this.deps.replier.reply(msg.userKey, COLD_REPLY);
      return;
    }

    await this.deps.handleCustomerMessage(msg);
  }

  private async onboard(userKey: string, token: string): Promise<void> {
    const { repo, replier, provisioner, chainId } = this.deps;

    // 1) Resolve the token.
    const scan = await repo.getPendingScan(token);
    if (!scan || scan.consumed) {
      log.info("scan missing or already consumed", { token, found: !!scan });
      await replier.reply(userKey, INVALID_REPLY);
      return;
    }

    // 2) Verify the signed merchant payload: it must bind to THIS scan and the
    //    signature must recover to the merchant's registered signer address.
    const merchant = await repo.getMerchant(scan.merchant_id);
    if (!merchant) {
      log.warn("scan references unknown merchant", { token, merchantId: scan.merchant_id });
      await replier.reply(userKey, INVALID_REPLY);
      return;
    }

    const m = scan.signed_payload.message;
    const bindsToScan =
      m.nonce === token &&
      m.merchantId === String(scan.merchant_id) &&
      m.points === String(scan.points);

    const signatureOk =
      bindsToScan &&
      (await verifyReceiptSignature({
        chainId,
        signer: merchant.signer_address as Address,
        signed: scan.signed_payload,
      }));

    if (!signatureOk) {
      log.warn("receipt rejected at signature check", {
        token,
        merchantId: scan.merchant_id,
        bindsToScan,
      });
      await replier.reply(userKey, BAD_SIG_REPLY);
      return; // forged/tampered payload — scan left unconsumed.
    }

    // 3) Create-or-lookup the customer by telegram_user_id.
    let customer = await repo.getCustomerByTelegram(userKey);
    let provisioned = false;
    if (!customer) {
      const wallet = await provisioner.provision();
      customer = await repo.createCustomerWithWallet({
        telegramUserId: userKey,
        walletAddress: wallet.address,
        walletMetadata: wallet.walletMetadata,
        shares: wallet.shares, // SECRET — vaulted in repo, never logged
      });
      provisioned = true;
      log.info("provisioned customer + wallet", {
        userKey: customer.user_key,
        walletAddress: wallet.address,
      });
    }

    // 4) Mark the scan consumed (atomic). If we lost the race, don't re-credit.
    const claimed = await repo.consumeScan(token);
    if (!claimed) {
      log.info("scan consumed concurrently", { token });
      await replier.reply(userKey, INVALID_REPLY);
      return;
    }

    // 5) Acknowledge — DO NOT mint yet, just say what's pending.
    const who = merchant.name ?? `merchant #${scan.merchant_id}`;
    await replier.reply(
      userKey,
      [
        provisioned ? "✅ Your account is ready." : "✅ Welcome back.",
        `Wallet: ${customer.wallet_address}`,
        `Pending from ${who}: ${scan.points} points will be credited.`,
      ].join("\n"),
    );
  }
}
