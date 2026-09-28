-- Guest trial (try the app without signing up) — run once in the Supabase SQL editor.
-- Idempotent: safe to re-run. Also needs Dashboard → Authentication → Sign In / Providers →
-- "Allow anonymous sign-ins" switched ON. See docs/context/web-app-decisions.md ("Guest trial").
--
-- A guest is a real Supabase ANONYMOUS user (auth.users.is_anonymous), so projects, ai_calls and
-- RLS all key off a normal user id and signing up later upgrades the same account in place.
--
--   trial_accounts  one row per guest account, with a HASHED client IP (never the raw address),
--                   registered the first time the guest uses the AI. Doubles as the registry the
--                   daily trial budget is summed over (ai_calls joined to it).
--   trial_uses      one row per counted AI action (build / rework / chat / findings / explain-fix).
--                   A failed or withheld attempt is released (released_at set) and stops counting.
--
-- Writes come only from the server with the service-role key; RLS is on with no policies, so a
-- guest can never read or edit their own quota.

create table if not exists public.trial_accounts (
  user_id    uuid primary key,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
-- Signed-in (non-guest) accounts are limited the same way until credits exist; only guests count
-- toward the daily guest budget and the per-IP account cap.
alter table public.trial_accounts add column if not exists is_guest boolean not null default true;
create index if not exists trial_accounts_ip_created_idx on public.trial_accounts (ip_hash, created_at desc);

create table if not exists public.trial_uses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  action_id   uuid not null,
  kind        text not null check (kind in ('build', 'rework', 'chat', 'findings', 'explain-fix')),
  created_at  timestamptz not null default now(),
  released_at timestamptz,
  unique (user_id, action_id, kind)
);
create index if not exists trial_uses_user_kind_idx on public.trial_uses (user_id, kind);

alter table public.trial_accounts enable row level security;
alter table public.trial_uses enable row level security;

-- Today's (UTC) AI spend by guest accounts, in USD.
create or replace function public.trial_spend_today() returns numeric
language sql security definer set search_path = public as $$
  select coalesce(sum(c.cost_usd), 0)
  from public.ai_calls c
  join public.trial_accounts t on t.user_id = c.user_id and t.is_guest
  where c.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');
$$;

-- Is the guest option open right now? (budget not yet spent)
create or replace function public.trial_budget_open(p_budget numeric) returns boolean
language sql security definer set search_path = public as $$
  select public.trial_spend_today() < p_budget;
$$;

-- Atomically decides whether a guest may run one AI action, and if so counts it.
-- Returns: 'ok' | 'quota' | 'needs-build' | 'ip-cap' | 'budget'
drop function if exists public.trial_reserve(uuid, text, text, uuid, int, int, numeric, boolean);
create or replace function public.trial_reserve(
  p_user uuid, p_ip_hash text, p_kind text, p_action uuid,
  p_limit int, p_ip_cap int, p_budget numeric, p_needs_build boolean, p_guest boolean
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_active int;
  v_released timestamptz;
  v_found boolean;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));

  if not exists (select 1 from public.trial_accounts where user_id = p_user) then
    if p_needs_build then return 'needs-build'; end if;
    if p_guest then
      if (select count(*) from public.trial_accounts
          where is_guest and ip_hash = p_ip_hash
            and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')) >= p_ip_cap then
        return 'ip-cap';
      end if;
      if not public.trial_budget_open(p_budget) then return 'budget'; end if;
    end if;
    insert into public.trial_accounts (user_id, ip_hash, is_guest) values (p_user, p_ip_hash, p_guest);
  end if;

  select true, released_at into v_found, v_released
  from public.trial_uses where user_id = p_user and action_id = p_action and kind = p_kind;
  if v_found and v_released is null then return 'ok'; end if;  -- a retry of an action already counted

  if p_needs_build and not exists (
    select 1 from public.trial_uses
    where user_id = p_user and kind in ('build', 'rework') and released_at is null
  ) then
    return 'needs-build';
  end if;

  select count(*) into v_active from public.trial_uses
  where user_id = p_user and kind = p_kind and released_at is null;
  if v_active >= p_limit then return 'quota'; end if;

  if v_found then
    update public.trial_uses set released_at = null where user_id = p_user and action_id = p_action and kind = p_kind;
  else
    insert into public.trial_uses (user_id, action_id, kind) values (p_user, p_action, p_kind);
  end if;
  return 'ok';
end $$;

-- Gives an attempt back (it failed, or its result was withheld). Every kind of that action.
create or replace function public.trial_release(p_user uuid, p_action uuid) returns void
language sql security definer set search_path = public as $$
  update public.trial_uses set released_at = now()
  where user_id = p_user and action_id = p_action and released_at is null;
$$;

-- Deletes guest accounts older than p_days (and, via their own FKs/cascades, what they owned).
-- Schedule it (Dashboard → Integrations → Cron) e.g. daily: select public.purge_anonymous_users(30);
create or replace function public.purge_anonymous_users(p_days int default 30) returns int
language plpgsql security definer set search_path = public, auth as $$
declare v_count int;
begin
  with gone as (
    delete from auth.users where is_anonymous and created_at < now() - make_interval(days => p_days) returning id
  ), t1 as (delete from public.trial_uses where user_id in (select id from gone)),
     t2 as (delete from public.trial_accounts where user_id in (select id from gone))
  select count(*) into v_count from gone;
  return v_count;
end $$;

revoke all on function public.trial_spend_today() from public, anon, authenticated;
revoke all on function public.trial_budget_open(numeric) from public, anon, authenticated;
revoke all on function public.trial_reserve(uuid, text, text, uuid, int, int, numeric, boolean, boolean) from public, anon, authenticated;
revoke all on function public.trial_release(uuid, uuid) from public, anon, authenticated;
revoke all on function public.purge_anonymous_users(int) from public, anon, authenticated;
