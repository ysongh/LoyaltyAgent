/**
 * Create the platform operator wallet (Dynamic MPC) and vault it in
 * operator_wallets (label 'primary'). Idempotent: prints the existing address if
 * one is already vaulted. The operator is the merchant-owner / minter used by the
 * Stage 4 bootstrap.
 *
 *   pnpm operator:create
 */
import { loadServerConfig } from "../config";
import { createServiceClient } from "../db/supabase";
import { Repo } from "../db/repo";
import { WalletProvisioner } from "../wallet";

const LABEL = "primary";

async function main() {
  const cfg = loadServerConfig();
  const repo = new Repo(createServiceClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey));

  const existing = await repo.getOperatorWallet(LABEL);
  if (existing) {
    console.log(`Operator wallet already vaulted (label '${LABEL}').`);
    console.log(`Address: ${existing.wallet_address}`);
    return;
  }

  const provisioner = new WalletProvisioner(cfg.dynamicEnvironmentId, cfg.dynamicAuthToken);
  const wallet = await provisioner.provision();
  await repo.saveOperatorWallet(LABEL, wallet.address, wallet.walletMetadata, wallet.shares);

  console.log("\n──────────────────────────────────────────────");
  console.log("Operator wallet created + vaulted (operator_wallets, label 'primary').");
  console.log("──────────────────────────────────────────────");
  console.log(`Address: ${wallet.address}`);
  console.log("");
  console.log("FUND THIS ADDRESS with testnet USDC (it pays gas + funds the escrow +");
  console.log("sends gas stipends to test customers): https://faucet.circle.com");
  console.log("");
}

main().catch((err) => {
  console.error("operator:create failed:", err);
  process.exit(1);
});
