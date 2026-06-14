/**
 * Proof of LIVE ENS resolution — no hard-coded name→address values. Resolves a
 * real mainnet ENS name on-chain and prints name → resolved address. The pass
 * condition is only "resolved to a valid address", not a hard-coded expected
 * value, so this demonstrates the lookup is genuinely live.
 *
 *   pnpm ens:demo [name.eth]     (default: vitalik.eth)
 */
import { loadServerConfig } from "../config";
import { EnsResolver } from "../chain/ens";

async function main() {
  const cfg = loadServerConfig();
  const name = (process.argv[2] || "vitalik.eth").toLowerCase();
  const ens = new EnsResolver(cfg.mainnetRpcUrl);

  console.log(`Resolving ${name} live on Ethereum mainnet (${cfg.mainnetRpcUrl})…`);
  const address = await ens.resolve(name);

  if (!address) {
    console.log(`✗ ${name} did not resolve.`);
    process.exit(1);
  }
  console.log(`✓ ${name} → ${address}`);
  console.log("(live on-chain getEnsAddress — no hard-coded mapping)");
}

main().catch((err) => {
  console.error("ens:demo failed:", err);
  process.exit(1);
});
