/**
 * One-time Stage 4 bootstrap so the verification scenarios can run. Idempotent.
 *
 *   pnpm bootstrap        (operator wallet must be created + funded first)
 *
 * Does, against the deployed native-USDC contracts:
 *   1. registerMerchant(operator)         — via the RELAYER owner key (if needed)
 *   2. operator setRate(demoId, RATE)
 *   3. operator fund(demoId) with escrow USDC
 *   4. operator mint(demoId, testCustomer, points)  — top up to MINT_POINTS
 *   5. operator gas-stipend → test customer (so it can sign its own redeem/gift)
 *   6. ensure a synthetic @giftee recipient customer exists (for the gift test)
 */
import { createWalletClient, formatEther, http, parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadServerConfig, requireEnv } from "../config";
import { createServiceClient } from "../db/supabase";
import { Repo } from "../db/repo";
import { WalletProvisioner } from "../wallet";
import { makePublicClient, arcChain } from "../chain/arc";
import { LOYALTY_POINTS_ABI, MERCHANT_ESCROW_ABI } from "../chain/abi";

const RATE = parseEther("0.001"); // 0.001 USDC (18-dec native) per point
const ESCROW_FUND = parseEther("1"); // top the pool up to ~1 USDC
const ESCROW_MIN = parseEther("0.5");
const MINT_POINTS = 500n;
const STIPEND = parseEther("0.3");
const STIPEND_MIN = parseEther("0.1");
const GIFTEE_HANDLE = "giftee";

async function main() {
  const cfg = loadServerConfig();
  const repo = new Repo(createServiceClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey));
  const pub = makePublicClient(cfg.arcChainId, cfg.arcRpcUrl);
  const chain = arcChain(cfg.arcChainId, cfg.arcRpcUrl);
  const loyalty = cfg.loyaltyPointsAddress;
  const escrow = cfg.merchantEscrowAddress;
  const id = BigInt(cfg.demoMerchantId);

  const op = await repo.getOperatorWallet("primary");
  if (!op) throw new Error("No operator wallet — run `pnpm operator:create` first.");
  const operatorAddr = op.wallet_address as Address;

  const opBal = await pub.getBalance({ address: operatorAddr });
  console.log(`Operator ${operatorAddr} balance: ${formatEther(opBal)} USDC`);
  if (opBal === 0n) {
    throw new Error(`Operator is unfunded — send testnet USDC to ${operatorAddr} (https://faucet.circle.com).`);
  }

  const provisioner = new WalletProvisioner(
    cfg.dynamicEnvironmentId,
    cfg.dynamicAuthToken,
    cfg.arcChainId,
    cfg.arcRpcUrl,
  );
  const operator = await provisioner.walletClientFor(op.wallet_metadata, op.shares);

  // 1) Register the merchant (owner-only) → operator becomes merchantOwner.
  let owner = (await pub.readContract({
    address: loyalty, abi: LOYALTY_POINTS_ABI, functionName: "merchantOwner", args: [id],
  })) as Address;
  if (owner === "0x0000000000000000000000000000000000000000") {
    const relayer = createWalletClient({
      account: privateKeyToAccount(requireEnv("RELAYER_PRIVATE_KEY") as `0x${string}`),
      chain,
      transport: http(cfg.arcRpcUrl),
    });
    console.log("registerMerchant(operator) via RELAYER…");
    const h = await relayer.writeContract({
      address: loyalty, abi: LOYALTY_POINTS_ABI, functionName: "registerMerchant", args: [operatorAddr],
    });
    await pub.waitForTransactionReceipt({ hash: h });
    owner = (await pub.readContract({
      address: loyalty, abi: LOYALTY_POINTS_ABI, functionName: "merchantOwner", args: [id],
    })) as Address;
  }
  if (owner.toLowerCase() !== operatorAddr.toLowerCase()) {
    throw new Error(`merchant ${id} is owned by ${owner}, not the operator ${operatorAddr}.`);
  }
  console.log(`✓ merchant ${id} owner = operator`);

  // 2) Rate.
  const rate = (await pub.readContract({
    address: escrow, abi: MERCHANT_ESCROW_ABI, functionName: "usdcPerPoint", args: [id],
  })) as bigint;
  if (rate !== RATE) {
    const h = await operator.writeContract({
      address: escrow, abi: MERCHANT_ESCROW_ABI, functionName: "setRate", args: [id, RATE],
    });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  console.log(`✓ rate = ${formatEther(RATE)} USDC/point`);

  // 3) Fund the escrow pool.
  const escBal = (await pub.readContract({
    address: escrow, abi: MERCHANT_ESCROW_ABI, functionName: "escrowBalance", args: [id],
  })) as bigint;
  if (escBal < ESCROW_MIN) {
    const h = await operator.writeContract({
      address: escrow, abi: MERCHANT_ESCROW_ABI, functionName: "fund", args: [id], value: ESCROW_FUND,
    });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  const escNow = (await pub.readContract({
    address: escrow, abi: MERCHANT_ESCROW_ABI, functionName: "escrowBalance", args: [id],
  })) as bigint;
  console.log(`✓ escrow pool = ${formatEther(escNow)} USDC`);

  // 4) Mint points to the test customer (top up to MINT_POINTS).
  const testTgId = requireEnv("TEST_CUSTOMER_TELEGRAM_ID");
  const cust = await repo.getCustomerByTelegram(testTgId);
  if (!cust?.wallet_address) throw new Error(`No onboarded customer for TEST_CUSTOMER_TELEGRAM_ID=${testTgId}.`);
  const custAddr = cust.wallet_address as Address;
  const custPoints = (await pub.readContract({
    address: loyalty, abi: LOYALTY_POINTS_ABI, functionName: "balanceOf", args: [custAddr, id],
  })) as bigint;
  if (custPoints < MINT_POINTS) {
    const h = await operator.writeContract({
      address: loyalty, abi: LOYALTY_POINTS_ABI, functionName: "mint",
      args: [id, custAddr, MINT_POINTS - custPoints],
    });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  const custPointsNow = (await pub.readContract({
    address: loyalty, abi: LOYALTY_POINTS_ABI, functionName: "balanceOf", args: [custAddr, id],
  })) as bigint;
  console.log(`✓ test customer ${custAddr} points = ${custPointsNow}`);

  // 5) Gas stipend so the customer can sign its own redeem/gift.
  const custGas = await pub.getBalance({ address: custAddr });
  if (custGas < STIPEND_MIN) {
    const h = await operator.sendTransaction({ to: custAddr, value: STIPEND });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  console.log(`✓ test customer gas = ${formatEther(await pub.getBalance({ address: custAddr }))} USDC`);

  // 6) Synthetic gift recipient @giftee (receives only — never signs).
  let giftee = await repo.getCustomerByUsername(GIFTEE_HANDLE);
  if (!giftee) {
    const w = await provisioner.provision();
    await repo.createCustomerWithWallet({
      telegramUserId: `synthetic-${GIFTEE_HANDLE}`,
      walletAddress: w.address,
      walletMetadata: w.walletMetadata,
      shares: w.shares,
    });
    await repo.setCustomerUsername(`synthetic-${GIFTEE_HANDLE}`, GIFTEE_HANDLE);
    giftee = await repo.getCustomerByUsername(GIFTEE_HANDLE);
  }
  console.log(`✓ @${GIFTEE_HANDLE} recipient = ${giftee?.wallet_address}`);

  console.log("\nBootstrap complete.");
}

main().catch((err) => {
  console.error("bootstrap failed:", err);
  process.exit(1);
});
