import { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import { ThresholdSignatureScheme } from "@dynamic-labs-wallet/node";

/**
 * Dynamic server-wallet service (proven in spike/). Creates MPC wallets and, for
 * Stage 4, hands back viem WalletClients to SIGN with them — used both for the
 * operator wallet and (custodial model) for a customer's own wallet.
 */
export interface ProvisionedWallet {
  address: string;
  /** Non-sensitive identity/backup-pointer info → *.wallet_metadata. */
  walletMetadata: unknown;
  /** SECRET MPC key material ({pubkey, secretShare}[]) → vault. */
  shares: unknown;
}

export class WalletProvisioner {
  private readonly client: DynamicEvmWalletClient;
  private authed = false;

  constructor(
    environmentId: string,
    private readonly authToken: string,
    private readonly chainId?: number,
    private readonly rpcUrl?: string,
  ) {
    this.client = new DynamicEvmWalletClient({ environmentId });
  }

  private async ensureAuth(): Promise<void> {
    if (this.authed) return;
    await this.client.authenticateApiToken(this.authToken);
    this.authed = true;
  }

  async provision(): Promise<ProvisionedWallet> {
    await this.ensureAuth();
    // backUpToDynamic:false => Dynamic does NOT keep the shares; we vault them
    // ourselves. (Matches the spike.)
    const created = await this.client.createWalletAccount({
      thresholdSignatureScheme: ThresholdSignatureScheme.TWO_OF_TWO,
      backUpToDynamic: false,
    });
    return {
      address: created.walletMetadata.accountAddress,
      walletMetadata: created.walletMetadata,
      shares: created.externalServerKeyShares,
    };
  }

  /**
   * Build a viem WalletClient that signs as the given wallet on Arc. `walletMetadata`
   * and `shares` are the values persisted at provision time (loaded from the vault).
   * SECRET `shares` flow straight into the SDK and are never logged.
   */
  async walletClientFor(walletMetadata: unknown, shares: unknown) {
    if (this.chainId === undefined || this.rpcUrl === undefined) {
      throw new Error("WalletProvisioner needs chainId + rpcUrl to build a signing client");
    }
    await this.ensureAuth();
    // Returns a viem WalletClient with the MPC account + Arc chain bound, so
    // writeContract/sendTransaction can be called WITHOUT explicit account/chain
    // (passing a bare address string would route to JSON-RPC signing instead).
    return this.client.getWalletClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      walletMetadata: walletMetadata as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      externalServerKeyShares: shares as any,
      chainId: this.chainId,
      rpcUrl: this.rpcUrl,
    });
  }
}
