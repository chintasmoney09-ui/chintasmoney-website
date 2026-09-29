-- ChintasMoney — Supabase database schema
-- Run this ONCE in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
-- It creates one table that holds each user's full app state as JSON,
-- protected so a user can only read/write their OWN row.

create table if not exists public.user_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

-- Each signed-in user may read their own row.
create policy "read own state"
  on public.user_state for select
  using ( auth.uid() = user_id );

-- Each signed-in user may create their own row.
create policy "insert own state"
  on public.user_state for insert
  with check ( auth.uid() = user_id );

-- Each signed-in user may update their own row.
create policy "update own state"
  on public.user_state for update
  using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );

-- Verified payments, written by the Razorpay webhook (Worker, service-role).
create table if not exists public.payments (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete set null,
  plan        text,
  amount      integer,
  razorpay_payment_id text,
  created_at  timestamptz not null default now()
);
-- Extra columns the webhook fills in (safe to re-run).
alter table public.payments add column if not exists email text;
alter table public.payments add column if not exists product text;
alter table public.payments add column if not exists status text default 'paid';
alter table public.payments add column if not exists method text;
alter table public.payments add column if not exists currency text;
alter table public.payments add column if not exists razorpay_order_id text;
-- Idempotency: one row per Razorpay payment (lets the webhook upsert on retries).
create unique index if not exists payments_rzp_payment_id_key on public.payments(razorpay_payment_id);

alter table public.payments enable row level security;
create policy "read own payments" on public.payments for select using ( auth.uid() = user_id );

-- Refunds, written by the Razorpay webhook (refund.created / refund.processed).
create table if not exists public.refunds (
  id          bigint generated always as identity primary key,
  razorpay_refund_id  text,
  razorpay_payment_id text,
  email       text,
  product     text,
  amount      integer,
  reason      text,
  status      text not null default 'refunded',
  created_at  timestamptz not null default now()
);
create unique index if not exists refunds_rzp_refund_id_key on public.refunds(razorpay_refund_id);
-- RLS on with no policy = only the service-role (Worker) can read/write it.
alter table public.refunds enable row level security;

-- Leads captured from opt-in forms (free tools, newsletter box) — permission-based
-- prospects the owner can email from the admin panel. Never used for scraped lists.
create table if not exists public.leads (
  id          bigint generated always as identity primary key,
  email       text not null,
  source      text,
  note        text,
  created_at  timestamptz not null default now()
);
-- One row per email (lets /api/lead upsert on repeat opt-ins).
create unique index if not exists leads_email_key on public.leads(email);
-- RLS on with no policy = only the service-role (Worker) can read/write it.
alter table public.leads enable row level security;

-- Web Push subscriptions (opt-in browser/phone push). Written by /api/push/subscribe.
create table if not exists public.push_subscriptions (
  id          bigint generated always as identity primary key,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  email       text,
  created_at  timestamptz not null default now()
);
-- One row per browser subscription (upsert on repeat opt-in).
create unique index if not exists push_subscriptions_endpoint_key on public.push_subscriptions(endpoint);
-- RLS on with no policy = only the service-role (Worker) can read/write it.
alter table public.push_subscriptions enable row level security;
