-- Payments: one row per checkout a researcher starts, and what became of it.
-- Must be applied before deploying the backend that serves /api/payments.
-- Safe to run more than once.
--
-- No card number, expiry or CVC is ever stored - Stripe holds those. What is kept is
-- what a receipt shows: the plan bought, the amount, the outcome, and the card's brand
-- and last four digits.

create table if not exists public.payments (
  id                         uuid primary key,
  owner_id                   uuid not null references auth.users (id) on delete cascade,
  plan_id                    text not null check (plan_id in ('researcher', 'lab')),
  billing                    text not null check (billing in ('monthly', 'annual')),
  -- In the currency's smallest unit (cents), as Stripe counts it: no float rounding.
  amount_cents               integer not null check (amount_cents > 0),
  currency                   text not null default 'usd',
  status                     text not null default 'pending'
                               check (status in ('pending', 'paid', 'failed', 'cancelled', 'expired')),
  provider                   text not null default 'stripe',
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text,
  card_brand                 text,
  card_last4                 text,
  receipt_url                text,
  -- The stretch of plan this payment bought. Set when it is paid.
  period_start               timestamptz,
  period_end                 timestamptz,
  failure_reason             text,
  created_at                 timestamptz not null default now(),
  paid_at                    timestamptz,
  updated_at                 timestamptz not null default now()
);

create index if not exists payments_owner_created_idx
  on public.payments (owner_id, created_at desc);

-- Same rule as subscriptions: RLS on with no policies, so the browser's API keys can
-- neither read nor forge a payment. Only the backend writes here, and only after
-- Stripe itself has said the payment succeeded.
alter table public.payments enable row level security;
