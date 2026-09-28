-- Subscriptions: the plan each account has chosen. No row means Free.
-- Must be applied before deploying the backend that serves /api/subscription.
-- Safe to run more than once.

create table if not exists public.subscriptions (
  owner_id   uuid primary key references auth.users (id) on delete cascade,
  plan_id    text not null default 'free' check (plan_id in ('free', 'researcher', 'lab')),
  billing    text not null default 'monthly' check (billing in ('monthly', 'annual')),
  status     text not null default 'active',
  started_at timestamptz not null default now(),
  renews_at  timestamptz,
  updated_at timestamptz not null default now()
);

-- RLS on with no policies: the anon and authenticated keys cannot read or write this
-- table through the Supabase API at all. Only the backend's own connection can, and it
-- scopes every query to the caller's token. Without this, a user could set their own
-- plan from the browser console.
alter table public.subscriptions enable row level security;
