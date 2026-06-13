import { network } from "hardhat";
import { formatEther } from "viem";

// Verifies the Arc Testnet config and that the relayer/deployer account is funded.
// Run with: npx hardhat run scripts/check-connection.ts --network arcTestnet
async function main() {
  const { viem } = await network.connect("arcTestnet");

  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  console.log(`Connected to RPC — reported chainId: ${chainId}`);
  if (chainId !== 5042002) {
    console.warn(`Warning: expected Arc Testnet chainId 5042002, got ${chainId}`);
  }

  const [wallet] = await viem.getWalletClients();
  if (!wallet) {
    console.error(
      "No deployer account configured. Set RELAYER_PRIVATE_KEY in .env (with 0x prefix).",
    );
    process.exitCode = 1;
    return;
  }

  const deployer = wallet.account.address;
  const balance = await publicClient.getBalance({ address: deployer });

  // Arc's native gas token is USDC, but the native balance uses 18 decimals (like ETH),
  // so formatEther is the correct conversion here.
  console.log(`Deployer address: ${deployer}`);
  console.log(`Native balance:   ${formatEther(balance)} USDC (gas token)`);

  if (balance === 0n) {
    console.warn(
      "Balance is 0 — fund this account with testnet USDC at https://faucet.circle.com before deploying.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
