-- Photo-receipt onboarding path. NOTE: this path has NO cryptographic proof
-- (unlike signed-QR) and credits immediately with NO confirm gate (demo
-- decision). receipt_claims is the ENTIRE abuse defense: image+content dedupe and
-- per-user daily cap. Service-role only; locked down.
create table if not exists public.receipt_claims (
  id           uuid primary key default gen_random_uuid(),
  user_key     uuid not null references public.customers(user_key) on delete cascade,
  image_hash   text not null,
  content_hash text not null,
  merchant     text,
  total        numeric,
  points       bigint not null,
  tx_hash      text,
  created_at   timestamptz not null default now()
);

-- Global uniqueness: the same receipt image, or the same {merchant,date,total}
-- claim, can never be credited twice (by anyone). These are the dedupe backstop.
create unique index if not exists receipt_claims_image_hash_key   on public.receipt_claims (image_hash);
create unique index if not exists receipt_claims_content_hash_key on public.receipt_claims (content_hash);
-- Per-user daily cap lookups.
create index if not exists receipt_claims_user_created_idx on public.receipt_claims (user_key, created_at);

alter table public.receipt_claims enable row level security;
revoke all on public.receipt_claims from anon, authenticated;
