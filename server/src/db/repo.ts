import type { SupabaseClient } from "@supabase/supabase-js";
import type { SignedReceipt } from "../receipt";

export interface Merchant {
  merchant_id: number;
  signer_address: string;
  name: string | null;
}

export interface PendingScan {
  token: string;
  signed_payload: SignedReceipt;
  merchant_id: number;
  points: number;
  consumed: boolean;
}

export interface Customer {
  user_key: string;
  telegram_user_id: string | null;
  wallet_address: string | null;
}

/** A wallet's material for custodial signing (loaded from the vault, never logged). */
export interface SigningWallet {
  userKey: string;
  address: string;
  walletMetadata: unknown;
  shares: unknown;
}

export interface OperatorWalletRow {
  wallet_address: string;
  wallet_metadata: unknown;
  shares: unknown;
}

/**
 * Data access over the service-role client. Secret `shares` are written here and,
 * for Stage 4, loaded back ONLY by the backend signer (never by any client-facing
 * query) and never logged.
 */
export class Repo {
  constructor(private readonly sb: SupabaseClient) {}

  // --- Stage 4: operator vault, custodial customer signing, gift recipients ---

  async getOperatorWallet(label: string): Promise<OperatorWalletRow | null> {
    const { data, error } = await this.sb
      .from("operator_wallets")
      .select("wallet_address, wallet_metadata, shares")
      .eq("label", label)
      .maybeSingle();
    if (error) throw error;
    return data as OperatorWalletRow | null;
  }

  async saveOperatorWallet(
    label: string,
    walletAddress: string,
    walletMetadata: unknown,
    shares: unknown,
  ): Promise<void> {
    const { error } = await this.sb
      .from("operator_wallets")
      .insert({ label, wallet_address: walletAddress, wallet_metadata: walletMetadata, shares });
    if (error) throw error;
  }

  /** Load a customer's full signing material (customers + wallet_key_shares). */
  async getCustomerSigningWallet(telegramUserId: string): Promise<SigningWallet | null> {
    const { data: customer, error } = await this.sb
      .from("customers")
      .select("user_key, wallet_address, wallet_metadata")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    if (error) throw error;
    if (!customer) return null;

    const c = customer as { user_key: string; wallet_address: string | null; wallet_metadata: unknown };
    const { data: keyRow, error: keyErr } = await this.sb
      .from("wallet_key_shares")
      .select("shares")
      .eq("user_key", c.user_key)
      .maybeSingle();
    if (keyErr) throw keyErr;
    if (!keyRow || !c.wallet_address) return null;

    return {
      userKey: c.user_key,
      address: c.wallet_address,
      walletMetadata: c.wallet_metadata,
      shares: (keyRow as { shares: unknown }).shares,
    };
  }

  /** Resolve a gift recipient by @handle to an onboarded customer with a wallet. */
  async getCustomerByUsername(username: string): Promise<Customer | null> {
    const handle = username.replace(/^@/, "").toLowerCase();
    const { data, error } = await this.sb
      .from("customers")
      .select("user_key, telegram_user_id, wallet_address")
      .eq("telegram_username", handle)
      .maybeSingle();
    if (error) throw error;
    return data as Customer | null;
  }

  /** Remember a customer's current Telegram handle (lowercased, no @). */
  async setCustomerUsername(telegramUserId: string, username: string): Promise<void> {
    const handle = username.replace(/^@/, "").toLowerCase();
    const { error } = await this.sb
      .from("customers")
      .update({ telegram_username: handle })
      .eq("telegram_user_id", telegramUserId);
    if (error) throw error;
  }

  async getMerchant(merchantId: number): Promise<Merchant | null> {
    const { data, error } = await this.sb
      .from("merchants")
      .select("merchant_id, signer_address, name")
      .eq("merchant_id", merchantId)
      .maybeSingle();
    if (error) throw error;
    return data as Merchant | null;
  }

  async getPendingScan(token: string): Promise<PendingScan | null> {
    const { data, error } = await this.sb
      .from("pending_scans")
      .select("token, signed_payload, merchant_id, points, consumed")
      .eq("token", token)
      .maybeSingle();
    if (error) throw error;
    return data as PendingScan | null;
  }

  /**
   * Atomically flip consumed false→true. Returns true only if THIS call won the
   * flip — a second/duplicate attempt gets false. Guards against double-provision.
   */
  async consumeScan(token: string): Promise<boolean> {
    const { data, error } = await this.sb
      .from("pending_scans")
      .update({ consumed: true })
      .eq("token", token)
      .eq("consumed", false)
      .select("token");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  async getCustomerByTelegram(telegramUserId: string): Promise<Customer | null> {
    const { data, error } = await this.sb
      .from("customers")
      .select("user_key, telegram_user_id, wallet_address")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    if (error) throw error;
    return data as Customer | null;
  }

  /**
   * Insert a new customer with its provisioned wallet, then vault the key shares
   * in the SEPARATE wallet_key_shares table. Secrets touch only the shares insert.
   */
  async createCustomerWithWallet(args: {
    telegramUserId: string;
    walletAddress: string;
    walletMetadata: unknown;
    shares: unknown;
  }): Promise<Customer> {
    const { data: customer, error } = await this.sb
      .from("customers")
      .insert({
        telegram_user_id: args.telegramUserId,
        wallet_address: args.walletAddress,
        wallet_metadata: args.walletMetadata,
      })
      .select("user_key, telegram_user_id, wallet_address")
      .single();
    if (error) throw error;

    const { error: sharesError } = await this.sb
      .from("wallet_key_shares")
      .insert({ user_key: (customer as Customer).user_key, shares: args.shares });
    if (sharesError) throw sharesError;

    return customer as Customer;
  }

  // --- Photo-receipt path: dedupe + daily cap ---

  async hasReceiptImage(imageHash: string): Promise<boolean> {
    const { data, error } = await this.sb
      .from("receipt_claims").select("id").eq("image_hash", imageHash).maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async hasReceiptContent(contentHash: string): Promise<boolean> {
    const { data, error } = await this.sb
      .from("receipt_claims").select("id").eq("content_hash", contentHash).maybeSingle();
    if (error) throw error;
    return !!data;
  }

  /** Sum of receipt points credited to a user since `sinceIso` (for the daily cap). */
  async sumReceiptPointsSince(userKey: string, sinceIso: string): Promise<bigint> {
    const { data, error } = await this.sb
      .from("receipt_claims").select("points").eq("user_key", userKey).gte("created_at", sinceIso);
    if (error) throw error;
    return (data ?? []).reduce((acc, r) => acc + BigInt((r as { points: number | string }).points), 0n);
  }

  /**
   * Reserve a claim (unique image_hash/content_hash). Returns the new id, or null
   * if a concurrent/duplicate claim already took one of the hashes (23505).
   */
  async reserveReceiptClaim(args: {
    userKey: string;
    imageHash: string;
    contentHash: string;
    merchant: string;
    total: number;
    points: bigint;
  }): Promise<string | null> {
    const { data, error } = await this.sb
      .from("receipt_claims")
      .insert({
        user_key: args.userKey,
        image_hash: args.imageHash,
        content_hash: args.contentHash,
        merchant: args.merchant,
        total: args.total,
        points: Number(args.points),
      })
      .select("id")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") return null; // unique violation = duplicate
      throw error;
    }
    return (data as { id: string }).id;
  }

  async setReceiptClaimTx(id: string, txHash: string): Promise<void> {
    const { error } = await this.sb.from("receipt_claims").update({ tx_hash: txHash }).eq("id", id);
    if (error) throw error;
  }

  async deleteReceiptClaim(id: string): Promise<void> {
    const { error } = await this.sb.from("receipt_claims").delete().eq("id", id);
    if (error) throw error;
  }
}
