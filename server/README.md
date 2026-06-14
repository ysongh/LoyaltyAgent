# Agent service

Transport-agnostic loyalty agent (Telegram now, SMS later). Customers earn and
spend on-chain loyalty points on Arc Testnet. See the repo `CLAUDE.md` for the
full architecture; this README covers the **two onboarding paths** and their very
different trust models.

## Commands (run in `server/`)

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the bot (live reload, Telegram long-polling). |
| `pnpm check` | Typecheck. |
| `pnpm seed` / `pnpm seed -- --forged` | Seed a signed-QR `pending_scan` (valid / forged). |
| `pnpm operator:create` | Create + vault the Dynamic operator wallet. |
| `pnpm bootstrap` | One-time on-chain setup (merchant, rate, escrow, mint, stipend, `@giftee`). |
| `pnpm test:intent` | Adversarial intent-parser test. |

## Two onboarding paths

### 1. Signed-QR receipt — trust-preserving
A merchant signs an EIP-712 receipt; the customer redeems it via `/start <token>`.
The signature is verified against the merchant's registered signer, the scan is
single-use (`consumed`), and points are credited deliberately. This is the
**proof-backed** path.

### 2. Photo receipt — ⚠️ NOT trust-preserving (demo shortcut)
A customer sends a **photo** of a receipt; Claude vision extracts the total and
points are credited **immediately** (1 pt per $1, floored).

> **DESIGN NOTE.** A photo carries **no cryptographic proof** that the purchase
> happened or that the image is authentic — unlike the signed-QR path. Per an
> explicit demo decision, this path credits **immediately with no confirm gate**.
> This is a known shortcut to be hardened later. The **only** abuse defense on
> this path is the set of cheap fraud controls below — they are not optional.

**Fraud controls (`receipt_claims` table, the entire defense):**
- **Image dedupe** — sha256 of the image bytes is globally unique; the same photo
  can't be credited twice.
- **Content dedupe** — sha256 of `{merchant,date,total}` is globally unique; the
  same receipt can't be re-claimed with a different photo.
- **Per-receipt cap** — `MAX_POINTS_PER_RECEIPT`; also `MAX_RECEIPT_TOTAL` rejects
  implausible totals.
- **Per-user daily cap** — `MAX_POINTS_PER_DAY` over a rolling 24h.
- Vision returns `looksGenuine` / `tamperConcerns`; these are **logged** but (per
  the demo decision) do **not** block crediting. Harden later by gating on them.

A photo from an unknown user **onboards** them (creates customer + Dynamic wallet,
then mints) — the frictionless story. Crediting mints via the operator wallet
(same path as Stage 4). The Stage 1 `dedupeId` guard prevents a retried photo
update from double-minting; the unique `image_hash`/`content_hash` indexes are the
durable backstop.

## Gift recipients: @username vs ENS (.eth)

The gift flow resolves two recipient types:

- **@username** → an onboarded customer whose Dynamic wallet **this system custodies**.
- **`.eth` (ENS)** → resolved **live on Ethereum mainnet** via `getEnsAddress`
  ([chain/ens.ts](src/chain/ens.ts)). There is **no hard-coded name→address map** —
  every lookup is a real on-chain call. ENS lives on mainnet (chainId 1), so a
  **separate** viem client points at `MAINNET_RPC_URL`; the Arc client cannot
  resolve ENS and no Arc transaction is ever routed through the mainnet client.

> **Honest note — ENS recipients are external.** A resolved `.eth` address is the
> recipient's **real external wallet**, which this system does **not** manage
> (unlike a custodial @username recipient whose wallet we provisioned). The gift
> sends to the resolved address **as-is** — we never silently swap it for a
> custodial wallet. An unresolved `.eth` name returns a clean "couldn't resolve"
> and does **not** fall back to the username path. ENS only determines the
> recipient address; the resolved address still flows through the same
> affordability check and confirm-then-execute YES gate before any tokens move.
> The confirmation shows `name → address` so the live resolution is visible.
