-- Stage 4: operator wallet vault + gift recipient resolution.

-- operator_wallets: SECRET vault for the platform operator's Dynamic MPC wallet
-- (merchant-owner / minter). One row per label. Service-role only; never selected
-- by any client-facing query; shares never logged.
create table if not exists public.operator_wallets (
  label           text primary key,
  wallet_address  text not null,
  wallet_metadata jsonb not null,
  shares          jsonb not null,
  created_at      timestamptz not null default now()
);

comment on table public.operator_wallets is
  'SECRET operator MPC wallet (metadata + key shares). Service-role only; never expose to clients or logs.';

-- Gift recipients are named by @username; customers were keyed only by numeric
-- telegram_user_id. Capture the handle so gifts can resolve recipient -> wallet.
-- Stored lowercased without a leading @.
alter table public.customers add column if not exists telegram_username text;
create index if not exists customers_telegram_username_idx
  on public.customers (telegram_username);

-- Lock down: RLS on, no anon/authenticated policies, privileges revoked.
alter table public.operator_wallets enable row level security;
revoke all on public.operator_wallets from anon, authenticated;
