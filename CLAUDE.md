# CLAUDE.md

Guidance for working in this repo.

## Project

On-chain loyalty-rewards app on **Arc Testnet** (Circle's chain where USDC is the
native gas token). Merchants mint ERC-1155 loyalty points to customers; customers
redeem points for USDC from a per-merchant escrow pool.

The smart-contract layer lives in `contracts/`. (A frontend is planned and will
handle user-facing decimal conversions — see "Rate decimals" below.)

## Conventions

- **Use `pnpm`, never `npm`.**
- Run all contract commands from inside `contracts/`.
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
