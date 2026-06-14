import { parseAbi } from "viem";

/** Minimal LoyaltyPoints (ERC-1155 + merchant registry) ABI — only what we call. */
export const LOYALTY_POINTS_ABI = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
  "function mint(uint256 merchantId, address to, uint256 amount)",
  "function registerMerchant(address merchant) returns (uint256)",
  "function merchantOwner(uint256 merchantId) view returns (address)",
]);

/** Minimal MerchantEscrow (native-USDC payout) ABI — only what we call. */
export const MERCHANT_ESCROW_ABI = parseAbi([
  "function redeem(uint256 merchantId, uint256 pointsAmount) returns (uint256)",
  "function usdcPerPoint(uint256 merchantId) view returns (uint256)",
  "function escrowBalance(uint256 merchantId) view returns (uint256)",
  "function setRate(uint256 merchantId, uint256 newUsdcPerPoint)",
  "function fund(uint256 merchantId) payable",
]);
