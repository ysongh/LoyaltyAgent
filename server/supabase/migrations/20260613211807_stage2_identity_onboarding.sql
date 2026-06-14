-- Stage 2: identity + onboarding schema.
-- This is a BACKEND-ONLY database accessed with the service role, which BYPASSES
-- RLS. We still enable RLS on every table with NO anon/authenticated policies
-- (default-deny) and revoke client-role privileges, so nothing is reachable
-- through the Data API. wallet_key_shares holds SECRET MPC key material.

-- merchants: registry mapping a merchant id to the address that signs receipts.
create table if not exists public.merchants (
  merchant_id    bigint primary key,
  signer_address text not null,
  name           text,
  created_at     timestamptz not null default now()
);

-- customers: transport-neutral identity. user_key IS the customer key; the
-- transport-specific resolvers (telegram_user_id, phone_hash) are nullable so an
-- SMS transport can later resolve to the same customer. telegram_user_id is NOT
-- the primary key.
create table if not exists public.customers (
  user_key         uuid primary key default gen_random_uuid(),
  telegram_user_id text unique,
  phone_hash       text,
  wallet_address   text,
  wallet_metadata  jsonb,
  created_at       timestamptz not null default now()
);

-- wallet_key_shares: SECRET Dynamic MPC key material, isolated from customers.
-- Written by the service role only; never selected by any client-facing query.
-- The secretShare material lives ONLY here.
create table if not exists public.wallet_key_shares (
  user_key   uuid primary key references public.customers(user_key) on delete cascade,
  shares     jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.wallet_key_shares is
  'SECRET MPC key shares ({pubkey, secretShare}[]). Service-role only; never expose to clients or logs.';

-- pending_scans: a signed merchant receipt awaiting redemption via /start <token>.
create table if not exists public.pending_scans (
  token          text primary key,
  signed_payload jsonb not null,
  merchant_id    bigint not null references public.merchants(merchant_id),
  points         bigint not null,
  consumed       boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Lock everything down. RLS enabled + no permissive policies = default deny for
-- anon/authenticated. The service role bypasses RLS, so the backend is unaffected.
alter table public.merchants         enable row level security;
alter table public.customers         enable row level security;
alter table public.wallet_key_shares enable row level security;
alter table public.pending_scans     enable row level security;

-- Defense in depth: strip all client-role privileges on every table.
revoke all on public.merchants         from anon, authenticated;
revoke all on public.customers         from anon, authenticated;
revoke all on public.wallet_key_shares from anon, authenticated;
revoke all on public.pending_scans     from anon, authenticated;
