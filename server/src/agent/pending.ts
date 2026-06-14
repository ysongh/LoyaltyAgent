/**
 * Minimal per-user pending-action state for the confirm-then-execute gate.
 * In-memory + single-process (the bot is one long-polling process), so the
 * markInFlight check-and-set is atomic. Actions expire so a stale YES can't fire
 * an old action.
 */
export interface PendingAction {
  type: "redeem" | "gift";
  /** Points to move (validated positive integer, as bigint for chain calls). */
  points: bigint;
  merchantId: number;
  /** Business name — required in the gift confirmation (viral loop). */
  business: string;
  /** Redeem: native-USDC (18-dec wei) the customer would receive. */
  usdcOut?: bigint;
  /** Gift: the resolved recipient. */
  recipientHandle?: string;
  recipientAddress?: `0x${string}`;
  createdAt: number;
  expiresAt: number;
  /** Set true the instant a YES starts executing — guards against a double YES. */
  inFlight: boolean;
}

const DEFAULT_TTL_MS = 5 * 60_000;

export class PendingStore {
  private readonly byUser = new Map<string, PendingAction>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  set(userKey: string, action: Omit<PendingAction, "createdAt" | "expiresAt" | "inFlight">): void {
    const now = Date.now();
    this.byUser.set(userKey, { ...action, createdAt: now, expiresAt: now + this.ttlMs, inFlight: false });
  }

  /** Returns the live (non-expired) action, or null (expired ones are purged). */
  get(userKey: string): PendingAction | null {
    const a = this.byUser.get(userKey);
    if (!a) return null;
    if (Date.now() > a.expiresAt) {
      this.byUser.delete(userKey);
      return null;
    }
    return a;
  }

  clear(userKey: string): void {
    this.byUser.delete(userKey);
  }

  /**
   * Atomically claim a live action for execution. Returns the action only to the
   * FIRST caller; a duplicate YES (already in-flight) gets null. Synchronous, so
   * no interleaving in single-threaded JS.
   */
  claim(userKey: string): PendingAction | null {
    const a = this.get(userKey);
    if (!a || a.inFlight) return null;
    a.inFlight = true;
    return a;
  }
}
