/**
 * Seed a pending_scans row with a real EIP-712-signed merchant receipt, so you
 * can generate a working `/start <token>` deep link to test onboarding.
 *
 *   pnpm seed            # valid receipt signed by the merchant test key
 *   pnpm seed -- --forged  # receipt signed by a DIFFERENT key (fails sig check)
 *
 * Env (server/.env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   — service-role DB access
 *   MERCHANT_TEST_PRIVATE_KEY                 — the registered merchant signer
 *   MERCHANT_TEST_ID (default 1), POINTS (default 100), ARC_CHAIN_ID (default 5042002)
 *   TELEGRAM_BOT_TOKEN (optional)             — used to print a ready t.me link
 */
import { randomUUID } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { requireEnv } from "../config";
import { createServiceClient } from "../db/supabase";
import { signReceipt } from "../receipt";

async function botUsername(): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const json = (await res.json()) as { ok: boolean; result?: { username?: string } };
    return json.ok ? (json.result?.username ?? null) : null;
  } catch {
    return null;
  }
}

async function main() {
  const forged = process.argv.includes("--forged");

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const merchantKey = requireEnv("MERCHANT_TEST_PRIVATE_KEY");
  const merchantId = BigInt(process.env.MERCHANT_TEST_ID?.trim() || "1");
  const points = BigInt(process.env.POINTS?.trim() || "100");
  const chainId = Number(process.env.ARC_CHAIN_ID?.trim() || "5042002");

  const sb = createServiceClient(supabaseUrl, serviceRoleKey);

  // The merchant registry always holds the REAL test signer address.
  const merchantAccount = privateKeyToAccount(merchantKey as `0x${string}`);
  const { error: merchantErr } = await sb.from("merchants").upsert({
    merchant_id: Number(merchantId),
    signer_address: merchantAccount.address,
    name: "Test Coffee Co.",
  });
  if (merchantErr) throw merchantErr;

  // For a forged scan, sign with a throwaway key so recovery != registered signer.
  const signingAccount = forged
    ? privateKeyToAccount(generatePrivateKey())
    : merchantAccount;

  const token = randomUUID();
  const signed = await signReceipt({
    chainId,
    account: signingAccount,
    merchantId,
    points,
    nonce: token,
  });

  const { error: scanErr } = await sb.from("pending_scans").insert({
    token,
    signed_payload: signed,
    merchant_id: Number(merchantId),
    points: Number(points),
    consumed: false,
  });
  if (scanErr) throw scanErr;

  const username = await botUsername();
  const link = username ? `https://t.me/${username}?start=${token}` : null;

  console.log("\n──────────────────────────────────────────────");
  console.log(forged ? "Seeded a FORGED pending scan (should be REJECTED)" : "Seeded a VALID pending scan");
  console.log("──────────────────────────────────────────────");
  console.log(`merchant_id:   ${merchantId}`);
  console.log(`merchant addr: ${merchantAccount.address}`);
  if (forged) console.log(`signed by:     ${signingAccount.address}  (≠ merchant → invalid)`);
  console.log(`points:        ${points}`);
  console.log(`token:         ${token}`);
  console.log(`/start arg:    /start ${token}`);
  if (link) console.log(`deep link:     ${link}`);
  else console.log("deep link:     (set TELEGRAM_BOT_TOKEN to print a t.me link)");
  console.log("");
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
