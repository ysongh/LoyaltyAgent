import {
  verifyTypedData,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";

/**
 * Off-chain merchant receipt, signed with EIP-712.
 *
 * The contracts don't define an on-chain signing scheme — a merchant's authority
 * is its `merchantOwner` address in LoyaltyPoints. So a receipt is signed by that
 * merchant key off-chain and verified here by recovering the signer and requiring
 * it to equal the merchant's registered `signer_address`.
 *
 * `nonce` is bound to the scan token, so a signature cannot be replayed against a
 * different token.
 */
export const RECEIPT_TYPES = {
  Receipt: [
    { name: "merchantId", type: "uint256" },
    { name: "points", type: "uint256" },
    { name: "nonce", type: "string" },
  ],
} as const;

export const RECEIPT_PRIMARY_TYPE = "Receipt" as const;

export function receiptDomain(chainId: number) {
  return { name: "LoyaltyReceipt", version: "1", chainId } as const;
}

/** The signed message as stored in `pending_scans.signed_payload` (jsonb). */
export interface SignedReceipt {
  /** uint256 values are stored as decimal strings (jsonb has no bigint). */
  message: { merchantId: string; points: string; nonce: string };
  signature: Hex;
}

/** Verify the signature recovers to `signer` for this exact message. */
export async function verifyReceiptSignature(opts: {
  chainId: number;
  signer: Address;
  signed: SignedReceipt;
}): Promise<boolean> {
  const { chainId, signer, signed } = opts;
  try {
    return await verifyTypedData({
      address: signer,
      domain: receiptDomain(chainId),
      types: RECEIPT_TYPES,
      primaryType: RECEIPT_PRIMARY_TYPE,
      message: {
        merchantId: BigInt(signed.message.merchantId),
        points: BigInt(signed.message.points),
        nonce: signed.message.nonce,
      },
      signature: signed.signature,
    });
  } catch {
    // Malformed signature / message → treat as invalid, never throw.
    return false;
  }
}

/** Sign a receipt with a merchant account. Used by the seed script. */
export async function signReceipt(opts: {
  chainId: number;
  account: LocalAccount;
  merchantId: bigint;
  points: bigint;
  nonce: string;
}): Promise<SignedReceipt> {
  const { chainId, account, merchantId, points, nonce } = opts;
  const signature = await account.signTypedData({
    domain: receiptDomain(chainId),
    types: RECEIPT_TYPES,
    primaryType: RECEIPT_PRIMARY_TYPE,
    message: { merchantId, points, nonce },
  });
  return {
    message: { merchantId: merchantId.toString(), points: points.toString(), nonce },
    signature,
  };
}
