import type { Address, PublicClient } from "viem";
import type { WalletProvisioner } from "../wallet";
import type { SigningWallet } from "../db/repo";
import { LOYALTY_POINTS_ABI, MERCHANT_ESCROW_ABI } from "./abi";

/**
 * On-chain execution against the deployed native-USDC contracts. Pure viem +
 * Dynamic — no transport or Anthropic types. Custodial model: the platform signs
 * a customer's own redeem/gift using that customer's vaulted shares.
 *
 * USDC amounts here are native 18-decimal wei (Arc's gas token); redeem payout is
 * `points * usdcPerPoint`, exact integer math (no rounding).
 */
export class ChainExecutor {
  constructor(
    private readonly pub: PublicClient,
    private readonly wallets: WalletProvisioner,
    private readonly loyalty: Address,
    private readonly escrow: Address,
  ) {}

  /** ERC-1155 balance of a customer for a merchant id. */
  async pointsBalance(account: Address, merchantId: number): Promise<bigint> {
    return (await this.pub.readContract({
      address: this.loyalty,
      abi: LOYALTY_POINTS_ABI,
      functionName: "balanceOf",
      args: [account, BigInt(merchantId)],
    })) as bigint;
  }

  async ratePerPoint(merchantId: number): Promise<bigint> {
    return (await this.pub.readContract({
      address: this.escrow,
      abi: MERCHANT_ESCROW_ABI,
      functionName: "usdcPerPoint",
      args: [BigInt(merchantId)],
    })) as bigint;
  }

  async escrowBalance(merchantId: number): Promise<bigint> {
    return (await this.pub.readContract({
      address: this.escrow,
      abi: MERCHANT_ESCROW_ABI,
      functionName: "escrowBalance",
      args: [BigInt(merchantId)],
    })) as bigint;
  }

  /**
   * Redeem the customer's own points (custodial sign). Ensures the escrow is an
   * approved operator first (one-time). Reverts bubble up as thrown errors.
   */
  async redeem(signer: SigningWallet, merchantId: number, points: bigint): Promise<`0x${string}`> {
    const wallet = await this.wallets.walletClientFor(signer.walletMetadata, signer.shares);
    const account = signer.address as Address;
    const id = BigInt(merchantId);

    const approved = (await this.pub.readContract({
      address: this.loyalty,
      abi: LOYALTY_POINTS_ABI,
      functionName: "isApprovedForAll",
      args: [account, this.escrow],
    })) as boolean;
    if (!approved) {
      const ah = await wallet.writeContract({
        address: this.loyalty,
        abi: LOYALTY_POINTS_ABI,
        functionName: "setApprovalForAll",
        args: [this.escrow, true],
      });
      await this.assertMined(ah);
    }

    const hash = await wallet.writeContract({
      address: this.escrow,
      abi: MERCHANT_ESCROW_ABI,
      functionName: "redeem",
      args: [id, points],
    });
    await this.assertMined(hash);
    return hash;
  }

  /**
   * Gift: the SENDER signs their own ERC-1155 transfer to the recipient. No
   * operator approval needed (sender == msg.sender == from).
   */
  async gift(
    sender: SigningWallet,
    merchantId: number,
    points: bigint,
    recipient: Address,
  ): Promise<`0x${string}`> {
    const wallet = await this.wallets.walletClientFor(sender.walletMetadata, sender.shares);
    const account = sender.address as Address;
    const hash = await wallet.writeContract({
      address: this.loyalty,
      abi: LOYALTY_POINTS_ABI,
      functionName: "safeTransferFrom",
      args: [account, recipient, BigInt(merchantId), points, "0x"],
    });
    await this.assertMined(hash);
    return hash;
  }

  /**
   * Mint points to a customer, signed by the OPERATOR (merchant-owner). Used by
   * the photo-receipt path to credit immediately.
   */
  async mint(
    operator: SigningWallet,
    merchantId: number,
    to: Address,
    amount: bigint,
  ): Promise<`0x${string}`> {
    const wallet = await this.wallets.walletClientFor(operator.walletMetadata, operator.shares);
    const hash = await wallet.writeContract({
      address: this.loyalty,
      abi: LOYALTY_POINTS_ABI,
      functionName: "mint",
      args: [BigInt(merchantId), to, amount],
    });
    await this.assertMined(hash);
    return hash;
  }

  private async assertMined(hash: `0x${string}`): Promise<void> {
    const receipt = await this.pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`transaction ${hash} reverted`);
    }
  }
}
