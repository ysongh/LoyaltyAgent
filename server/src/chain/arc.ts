import { createPublicClient, defineChain, http, type PublicClient } from "viem";

/**
 * Arc Testnet. Native gas token is USDC at 18 decimals — the escrow funds and
 * pays out in this native value (NOT the 6-decimal ERC-20 path), so formatEther/
 * parseEther are the correct conversions for USDC amounts here.
 */
export function arcChain(chainId: number, rpcUrl: string) {
  return defineChain({
    id: chainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
    testnet: true,
  });
}

export function makePublicClient(chainId: number, rpcUrl: string): PublicClient {
  return createPublicClient({ chain: arcChain(chainId, rpcUrl), transport: http(rpcUrl) });
}

/** An arcscan transaction URL for confirmations. */
export function txUrl(hash: string): string {
  return `https://testnet.arcscan.app/tx/${hash}`;
}
