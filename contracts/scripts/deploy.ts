import { network } from "hardhat";
import { getAddress, isAddress } from "viem";

// Deploys LoyaltyPoints and MerchantEscrow to Arc Testnet.
// Run with: npx hardhat run scripts/deploy.ts --network arcTestnet
//
// The escrow funds and pays out in Arc's NATIVE USDC (the gas token), so no token
// address is needed.
//
// Required env:
//   RELAYER_PRIVATE_KEY  deployer/relayer key (also the LoyaltyPoints owner by default)
// Optional env:
//   TOKEN_URI            ERC-1155 metadata URI (default below)
//   LOYALTY_OWNER        platform owner of LoyaltyPoints (default: deployer)
async function main() {
  const { viem } = await network.connect("arcTestnet");

  const publicClient = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();
  if (!wallet) {
    throw new Error(
      "No deployer account configured. Set RELAYER_PRIVATE_KEY in .env (with 0x prefix).",
    );
  }
  const deployer = wallet.account.address;

  // --- resolve config ---
  const ownerRaw = process.env.LOYALTY_OWNER;
  if (ownerRaw && !isAddress(ownerRaw)) {
    throw new Error("LOYALTY_OWNER is set but is not a valid address.");
  }
  const loyaltyOwner = ownerRaw ? getAddress(ownerRaw) : deployer;

  const tokenUri =
    process.env.TOKEN_URI ?? "https://loyalty.example/metadata/{id}.json";

  // --- sanity checks ---
  const chainId = await publicClient.getChainId();
  if (chainId !== 5042002) {
    console.warn(`Warning: expected Arc Testnet chainId 5042002, got ${chainId}`);
  }
  const balance = await publicClient.getBalance({ address: deployer });
  if (balance === 0n) {
    throw new Error(
      `Deployer ${deployer} has 0 native balance — fund it with testnet USDC at https://faucet.circle.com before deploying.`,
    );
  }

  console.log("Deploying with:");
  console.log(`  deployer:       ${deployer}`);
  console.log(`  loyalty owner:  ${loyaltyOwner}`);
  console.log(`  payout token:   native USDC (Arc gas token)`);
  console.log(`  token URI:      ${tokenUri}`);
  console.log("");

  // --- deploy LoyaltyPoints ---
  const loyalty = await viem.deployContract("LoyaltyPoints", [tokenUri, loyaltyOwner]);
  console.log(`LoyaltyPoints deployed: ${loyalty.address}`);

  // --- deploy MerchantEscrow (pays out in native USDC; references the loyalty contract) ---
  const escrow = await viem.deployContract("MerchantEscrow", [loyalty.address]);
  console.log(`MerchantEscrow deployed: ${escrow.address}`);

  console.log("\nDeployment complete. Summary:");
  console.log(
    JSON.stringify(
      {
        chainId,
        deployer,
        loyaltyOwner,
        payoutToken: "native-USDC",
        LoyaltyPoints: loyalty.address,
        MerchantEscrow: escrow.address,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
