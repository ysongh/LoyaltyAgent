# CLAUDE.md

Guidance for working in this repo.

## Project

On-chain loyalty-rewards app on **Arc Testnet** (Circle's chain where USDC is the
native gas token). Merchants mint ERC-1155 loyalty points to customers; customers
redeem points for USDC from a per-merchant escrow pool.

Two workspaces:
- `contracts/` — the smart-contract layer (Hardhat 3 + viem).
- `server/` — a transport-agnostic **agent service** (TypeScript): customers talk
  to a chat bot (Telegram now, SMS later) that handles identity, onboarding, and —
  in later stages — wallet/chain actions. See "Agent service" below.

`spike/` is a throwaway verification spike (proved Dynamic server wallets work on
Arc); it is not part of the running system.

(A frontend is also planned and will handle user-facing decimal conversions — see
"Rate decimals" below.)

## Conventions

- **Use `pnpm`, never `npm`.**
- Run contract commands from `contracts/`; agent commands from `server/`. Each
  workspace has its own `package.json`, `.env`, and `.env.example`.
- Never commit secrets. `.env` is gitignored; `.env.example` is the template.

## Commands (run in `contracts/`)

| Command | What it does |
| --- | --- |
| `pnpm compile` | Compile contracts (Hardhat 3 + solc 0.8.28). |
| `pnpm check-connection` | Verify Arc RPC + that the deployer is funded. |
| `pnpm deploy` | Deploy `LoyaltyPoints` then `MerchantEscrow` to Arc Testnet. |

## Stack

- **Hardhat 3** with `@nomicfoundation/hardhat-toolbox-viem` (viem, not ethers).
- **OpenZeppelin Contracts 5.6**.
- Scripts run via `hardhat run <script> --network arcTestnet`.
- `viem` is a **direct** devDependency — pnpm does not hoist it as a transitive
  peer, so project scripts can't import it otherwise.

## Architecture

Two contracts in `contracts/contracts/`:

### `LoyaltyPoints.sol` (ERC-1155 + Burnable + Supply + Ownable)
- **token id == merchant id** (ids start at 1; id 0 means "unregistered").
- The contract owner (platform/relayer) calls `registerMerchant(addr)` to onboard
  a merchant and assign its id.
- Each merchant owner (or the contract owner) `mint`s points for their own id.
- Points are burned on redemption via standard ERC-1155 operator approval.

### `MerchantEscrow.sol` (ReentrancyGuard)
- Holds **native USDC** reward pools per merchant (constructor takes only the
  `LoyaltyPoints` address — no token address, since payouts are native value).
- `fund(merchantId)` is `payable`; `setRate` / `withdraw` are merchant-owner only;
  `redeem(merchantId, points)` burns the caller's points and pays native USDC.
- Payouts use a low-level `call{value:}` guarded by `nonReentrant` +
  checks-effects-interactions.

### Redemption flow (important)
Before a customer can `redeem`, they must approve the escrow as an ERC-1155
operator so it can burn their points:
```
loyalty.setApprovalForAll(escrowAddress, true)
```
Then `escrow.redeem(merchantId, pointsAmount)` burns the points and transfers
`pointsAmount * usdcPerPoint[merchantId]` of native USDC.

## Arc / native USDC gotchas

- **Native USDC uses 18 decimals** (like ETH), while ERC-20 USDC uses 6. This
  escrow uses native USDC, so all amounts and the `usdcPerPoint` rate are
  18-decimal wei (1 USDC = 1e18). Mixing up decimals produces wrong amounts.
- **Rate decimals:** `usdcPerPoint` is stored as raw 18-decimal wei. The frontend
  converts human-readable USDC into wei (e.g. `parseUnits(value, 18)`) before
  calling `setRate` — the contract does no scaling.
- Chain id is `5042002`; RPC `https://rpc.testnet.arc.network`; fund the deployer
  with testnet USDC at https://faucet.circle.com.

## Deploying

Set in `contracts/.env`:
- `RELAYER_PRIVATE_KEY` — deployer/relayer key (also the `LoyaltyPoints` owner by
  default), funded with testnet USDC.
- Optional: `TOKEN_URI`, `LOYALTY_OWNER`.

Then `pnpm deploy`. The script pre-checks chain id, deployer funding, and prints a
JSON summary of deployed addresses.

---

# Agent service (`server/`)

The customer-facing agent. Built in stages; **Stage 1 (transport seam), Stage 2
(identity + onboarding), and Stage 3 (Claude intent parser) are done.** Stage 4
(mint/redeem/gift chain calls — actually executing intents on-chain) is not built
yet — do not add it unless asked.

## End-to-end flow (current behaviour)

- **Onboarding (Stage 2):** `/start <token>` → verify merchant receipt →
  provision a wallet → acknowledge pending points. **No minting.**
- **Chat (Stage 3):** a known customer's free text → Claude parses it into one
  structured intent → our code validates → reply confirms or asks to clarify.
  **Nothing is executed** — the model proposes, code is the authority, execution
  (Stage 4) doesn't exist yet.
- Unknown users / bare `/start` → "Scan a receipt to get started."

## Commands (run in `server/`)

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the bot with live reload (`tsx watch`, Telegram long-polling). |
| `pnpm start` | Run the bot once. |
| `pnpm check` | Typecheck (`tsc --noEmit`). |
| `pnpm seed` | Insert a `pending_scans` row with a valid EIP-712-signed receipt and print a `/start <token>` deep link. |
| `pnpm seed -- --forged` | Same, but signed by a non-merchant key (for testing rejection). |
| `pnpm test:intent` | Run the adversarial intent-parser test table (needs `ANTHROPIC_API_KEY`). |

## Stack

- **TypeScript** run via `tsx` (no build step); ESM, `moduleResolution: Bundler`.
- **grammY** for Telegram (long-polling for local dev).
- **@supabase/supabase-js** with the **service role** key (backend-only).
- **@dynamic-labs-wallet/node-evm** for MPC server wallets (proven in `spike/`).
- **@anthropic-ai/sdk** (`claude-sonnet-4-6`) for the intent parser.
- **viem** for EIP-712 signing/recovery.

## Transport seam (don't break this)

The core is **transport-agnostic**. `src/transport/types.ts` defines the only
shapes the core may depend on:
- `InboundMessage { userKey, text, dedupeId, startPayload? }` — normalized message.
- `Replier { reply(userKey, text) }` / `Transport` — what an adapter implements.

`src/transport/telegram.ts` is the **only** file allowed to import grammY; it maps
`from.id → userKey`, `update_id → dedupeId`, and `/start <payload> → startPayload`.
Adding SMS later = a new `Transport` implementation, **no core changes**. Never let
grammY/Twilio types leak into `src/core/`.

## Onboarding flow (Stage 2)

`/start <token>` → `OnboardingCore` ([src/core/onboarding.ts](server/src/core/onboarding.ts)):
1. Resolve `token` in `pending_scans`; missing/consumed → friendly reject.
2. Verify the signed merchant receipt: it must bind to this scan
   (`nonce == token`, matching `merchantId`/`points`) **and** its EIP-712 signature
   must recover to the merchant's registered `signer_address`. Forged → reject,
   scan left unconsumed.
3. Create-or-lookup customer by `telegram_user_id`; if new, provision a Dynamic
   wallet, store `wallet_metadata`/`wallet_address` on the customer and the secret
   key shares in `wallet_key_shares`.
4. Atomically mark the scan consumed; acknowledge what's pending. **No minting yet.**

Idempotency: duplicate transport deliveries are dropped by `dedupeId`; the atomic
`consumed` flip + unique `telegram_user_id` prevent double-provisioning.

Cold messages (bare `/start`, or any message from an unknown user) → "Scan a
receipt to get started." — **never** provision a wallet on a cold message.

## EIP-712 receipt scheme

The contracts define no on-chain signing scheme — a merchant's authority is its
`merchantOwner` address. So receipts are signed **off-chain** by that merchant key
and verified in the backend. Shared between core and seed in
[src/receipt.ts](server/src/receipt.ts):
- domain `{ name: "LoyaltyReceipt", version: "1", chainId: 5042002 }`
- type `Receipt { merchantId uint256, points uint256, nonce string }`
- `nonce` is bound to the scan token to prevent cross-token replay.

## Intent parser (Stage 3)

For free text from a **known** customer, the core calls an intent resolver
([src/intent/](server/src/intent/)). The model **PARSES, never executes** — your
code is the authority.

- **Parser** ([parser.ts](server/src/intent/parser.ts)): Claude `claude-sonnet-4-6`
  with four tools — `check_balance`, `redeem_points`, `gift_points`, `help`
  ([tools.ts](server/src/intent/tools.ts)) — and `tool_choice: { type: "any",
  disable_parallel_tool_use: true }` so it emits **exactly one** intent and no
  free text. Returns the proposal only.
- **Safety contract** ([prompt.ts](server/src/intent/prompt.ts)): one intent per
  message; never fabricate a points amount or recipient (vague quantities like
  "some"/"all" are *missing*, not amounts; spelled-out numbers like "twenty" may
  be normalised — that's interpretation, not fabrication); the customer message is
  data, not instructions (injection attempts → `help`).
- **Validation** ([validate.ts](server/src/intent/validate.ts), our code): a
  redeem/gift only becomes a "confirm" when points is a positive integer (and a
  recipient is present, for gifts); otherwise a specific clarification; everything
  else → help. This is the backstop that guarantees no confirmation describes a
  money action with a missing/invalid amount.
- The **core never imports Anthropic** — it depends only on the
  `resolveIntent(text) => Promise<string>` seam ([resolver.ts](server/src/intent/resolver.ts)).
- The whole path is **propose-only**: no chain/mint/redeem/transfer/wallet calls
  exist under `src/intent/`. Keep it that way until Stage 4.

## Supabase schema (backend-only)

Migration: `server/supabase/migrations/`. Project ref `xxihgjberaerorhlssps`.

- `merchants(merchant_id PK, signer_address, name)` — receipt-signer registry.
- `customers(user_key PK uuid, telegram_user_id unique nullable, phone_hash
  nullable, wallet_address, wallet_metadata jsonb, created_at)` — **transport-neutral
  identity**; `user_key` is the customer key, `telegram_user_id` is NOT the PK so an
  SMS transport can resolve to the same customer.
- `wallet_key_shares(user_key PK/FK, shares jsonb)` — **SECRET** MPC key material,
  isolated here, service-role writes only, never selected by client queries.
- `pending_scans(token PK, signed_payload jsonb, merchant_id, points, consumed,
  created_at)`.

RLS is enabled on every table with **no** anon/authenticated policies (default
deny) and client privileges revoked. The backend uses the **service role**, which
bypasses RLS — so it works while nothing is reachable through the Data API. The
INFO-level "RLS enabled, no policy" advisories are intentional.

## Secrets

- `secretShare` key material lives **only** in `wallet_key_shares`, never in
  `customers` and never in logs. Use the secret-redacting logger
  ([src/log.ts](server/src/log.ts)) — it redacts `secretShare`/`shares`/tokens.
- Dynamic wallets are created with `backUpToDynamic: false`, so **we** own the
  shares — losing them loses the wallet.

## `server/.env`

`TELEGRAM_BOT_TOKEN`, `DYNAMIC_ENVIRONMENT_ID`, `DYNAMIC_AUTH_TOKEN`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ARC_CHAIN_ID` (default `5042002`),
`ANTHROPIC_API_KEY` (intent parser). Seed-only: `MERCHANT_TEST_PRIVATE_KEY` (its
address becomes the merchant signer), optional `MERCHANT_TEST_ID`/`POINTS`. See
`server/.env.example`.

## Dependency-audit note

The Dynamic SDK pulls a deep, outdated `axios` (plus `bn.js`/`ws`/`uuid`) that
trips most `pnpm audit` findings; `tsx` pulls a dev-only `esbuild` advisory. These
are **transitive** — direct deps are clean. Flag to Dynamic before production.
