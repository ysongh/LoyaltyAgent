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

/**
 * Data access over the service-role client. The secret `shares` are written here
 * and never read back by any method (no select on wallet_key_shares).
 */
export class Repo {
  constructor(private readonly sb: SupabaseClient) {}

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
}
