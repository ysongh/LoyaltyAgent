# Contracts — Loyalty Rewards (Arc Testnet)

Smart-contract layer for an on-chain loyalty-rewards app on **Arc Testnet**, the
Circle chain where USDC is the native gas token. Merchants mint ERC-1155 loyalty
points to customers; customers redeem points for native USDC from a per-merchant
escrow pool.

Built with **Hardhat 3** + `hardhat-toolbox-viem` (viem) and **OpenZeppelin 5.6**.

## Setup

```bash
pnpm install
cp .env.example .env   # then fill in RELAYER_PRIVATE_KEY
```

Fund the deployer account with testnet USDC at https://faucet.circle.com before
running any network script — on Arc, gas is paid in USDC.

## Commands

| Command | Description |
| --- | --- |
| `pnpm compile` | Compile contracts (solc 0.8.28). |
| `pnpm check-connection` | Verify the Arc RPC connection and deployer funding. |
| `pnpm deploy` | Deploy `LoyaltyPoints` then `MerchantEscrow` to Arc Testnet. |

## Contracts

### `LoyaltyPoints.sol` — ERC-1155 + Burnable + Supply + Ownable

Each **token id maps 1:1 to a merchant id** (ids start at 1; id 0 = unregistered).

- `registerMerchant(address)` — owner-only; onboards a merchant, returns its id.
- `mint(merchantId, to, amount)` — merchant owner (or contract owner) mints points.
- `transferMerchantOwnership(merchantId, newOwner)` — hand off control of an id.
- Points are burned on redemption via standard ERC-1155 operator approval.

### `MerchantEscrow.sol` — ReentrancyGuard

Holds **native USDC** reward pools per merchant. Constructor takes only the
`LoyaltyPoints` address (payouts are native value, so there is no token address).

- `fund(merchantId)` — `payable`; anyone can top up a merchant's pool with native USDC.
- `setRate(merchantId, usdcPerPoint)` — merchant-owner only; native USDC wei per point.
- `withdraw(merchantId, amount, to)` — merchant-owner only; pull unredeemed funds.
- `redeem(merchantId, points)` — burns the caller's points, pays `points * rate`
  in native USDC. Guarded by `nonReentrant` + checks-effects-interactions.

## Redemption flow

A customer must approve the escrow as an ERC-1155 operator before redeeming, so it
can burn their points:

```ts
// 1. customer approves the escrow once
await loyalty.write.setApprovalForAll([escrowAddress, true]);

// 2. customer redeems points for native USDC
await escrow.write.redeem([merchantId, pointsAmount]);
```

## Decimals (read this)

On Arc, **native USDC uses 18 decimals** (like ETH), while ERC-20 USDC uses 6.
This escrow uses native USDC, so every amount — including the `usdcPerPoint` rate —
is 18-decimal wei (`1 USDC = 1e18`). The contract does **no** scaling; convert
human-readable values in the client, e.g. `parseUnits("0.01", 18)`.

## Network

| Field | Value |
| --- | --- |
| Network | Arc Testnet |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | https://testnet.arcscan.app |
| Faucet | https://faucet.circle.com |

## Environment

`.env` (see `.env.example`):

- `RELAYER_PRIVATE_KEY` — deployer/relayer key (also the `LoyaltyPoints` owner by
  default), with the `0x` prefix.
- `ARC_TESTNET_RPC_URL` — optional RPC override.
- `TOKEN_URI` — optional ERC-1155 metadata URI.
- `LOYALTY_OWNER` — optional platform owner (defaults to the deployer).

## Status

Contracts implemented and compiling; deploy script verified up to the funding
check. **Tests are not yet written.**
