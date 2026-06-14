import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

/**
 * Live ENS resolution. ENS lives on Ethereum MAINNET (chainId 1) — even though
 * this app transacts on Arc — so this uses a SEPARATE mainnet public client used
 * ONLY for name resolution. No Arc transactions are ever routed through it, and
 * there is NO hard-coded name→address table: every lookup is a real on-chain
 * `getEnsAddress` call against the mainnet ENS registry/universal resolver.
 */
export class EnsResolver {
  private readonly client: PublicClient;

  constructor(rpcUrl: string) {
    this.client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
  }

  /** True if the string is an ENS name we should resolve on-chain. */
  static isEnsName(s: string): boolean {
    return s.trim().toLowerCase().endsWith(".eth");
  }

  /** Resolve `name` to an address via a live mainnet lookup, or null if unresolved/invalid. */
  async resolve(name: string): Promise<Address | null> {
    try {
      return await this.client.getEnsAddress({ name: normalize(name.trim()) });
    } catch {
      // Malformed name (normalize throws) or RPC error → treat as unresolved.
      return null;
    }
  }
}
