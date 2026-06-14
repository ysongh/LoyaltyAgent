import { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import { ThresholdSignatureScheme } from "@dynamic-labs-wallet/node";

/**
 * Provisions Dynamic server wallets (proven in spike/). MPC keygen only — no RPC
 * or chain calls here. Returns the address + metadata to persist, and the SECRET
 * key shares to vault separately.
 */
export interface ProvisionedWallet {
  address: string;
  /** Non-sensitive identity/backup-pointer info → customers.wallet_metadata. */
  walletMetadata: unknown;
  /** SECRET MPC key material ({pubkey, secretShare}[]) → wallet_key_shares.shares. */
  shares: unknown;
}

export class WalletProvisioner {
  private readonly client: DynamicEvmWalletClient;
  private authed = false;

  constructor(
    private readonly environmentId: string,
    private readonly authToken: string,
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
    // backUpToDynamic:false => Dynamic does NOT keep the shares; we vault them in
    // wallet_key_shares ourselves. (Matches the spike.)
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
}
