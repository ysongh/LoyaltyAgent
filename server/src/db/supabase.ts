import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for the backend. The service role BYPASSES RLS,
 * which is why every table is locked down to anon/authenticated. This key is a
 * secret and must never reach a client/browser.
 */
export function createServiceClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
