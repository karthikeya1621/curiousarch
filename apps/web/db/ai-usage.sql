-- AI usage tracking — run once in the Supabase SQL editor (Dashboard → SQL).
-- Idempotent: safe to re-run. See apps/web/README.md ("AI usage tracking").
--
-- Three tables:
--   ai_calls            one row per AI API request (retries included): who, which
--                       project/action, model, tokens, cost, outcome, latency.
--                       Kept indefinitely. Metrics only — no prompt text.
--   ai_call_payloads    the full system prompt, messages and response for a call.
--                       Contains users' architecture descriptions, so it is purged
--                       on a schedule (purge_ai_call_payloads below) and is not
--                       readable by users at all.
--   ai_action_outcomes  "this response was paid for but never shown" reports from the
--                       client (project switched, superseded, withheld) — the wasted-
--                       spend signal.
--
-- Writes come ONLY from the server with the service-role key (which bypasses RLS).
-- There are deliberately no insert/update/delete policies: a user who could write
-- their own usage rows could hide what they spent. project_id and action_id have
-- no foreign keys on purpose — usage history must outlive a deleted project, and
-- versions live inside the projects JSON, so action_id (stored on each version) is
-- their join key.

create table if not exists public.ai_calls (
  id                          uuid primary key,
  created_at                  timestamptz not null,
  user_id                     uuid not null,
  project_id                  uuid,
  action_id                   uuid not null,
  action                      text not null check (action in ('build', 'rework', 'findings', 'chat', 'explain-fix')),
  label                       text not null,
  attempt                     int  not null,
  model                       text not null,
  outcome                     text not null check (outcome in ('ok', 'invalid', 'no-tool', 'error')),
  error                       text,
  stop_reason                 text,
  request_id                  text,
  input_tokens                int,
  output_tokens               int,
  cache_creation_input_tokens int,
  cache_read_input_tokens     int,
  cost_usd                    numeric(12, 6),
  cache_savings_usd           numeric(12, 6),
  price_version               text,
  duration_ms                 int  not null,
  max_tokens                  int,
  system_prompt_hash          text,
  request_chars               int,
  context                     jsonb not null default '{}'::jsonb
);

create index if not exists ai_calls_user_created_idx    on public.ai_calls (user_id, created_at desc);
create index if not exists ai_calls_project_created_idx on public.ai_calls (project_id, created_at desc);
create index if not exists ai_calls_action_idx          on public.ai_calls (action_id);
create index if not exists ai_calls_label_created_idx   on public.ai_calls (label, created_at desc);

create table if not exists public.ai_call_payloads (
  call_id       uuid primary key references public.ai_calls (id) on delete cascade,
  created_at    timestamptz not null default now(),
  system_prompt text,
  messages      jsonb,
  output        jsonb
);

create index if not exists ai_call_payloads_created_idx on public.ai_call_payloads (created_at);

create table if not exists public.ai_action_outcomes (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id    uuid not null,
  action_id  uuid not null,
  reason     text not null check (reason in ('project-switched', 'superseded', 'withheld'))
);

create index if not exists ai_action_outcomes_action_idx on public.ai_action_outcomes (action_id);

-- ---- Row level security ----------------------------------------------------
alter table public.ai_calls           enable row level security;
alter table public.ai_call_payloads   enable row level security;
alter table public.ai_action_outcomes enable row level security;

-- A user may READ their own usage (e.g. for a future "your usage" page or credit
-- balance). Nothing else, and no access at all to payloads.
drop policy if exists "read own ai_calls" on public.ai_calls;
create policy "read own ai_calls" on public.ai_calls
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "read own ai_action_outcomes" on public.ai_action_outcomes;
create policy "read own ai_action_outcomes" on public.ai_action_outcomes
  for select to authenticated using (auth.uid() = user_id);

-- Belt and braces on top of RLS (Supabase grants new public tables to these roles
-- by default): only the service role may write, users may only read their own.
revoke all on public.ai_calls, public.ai_call_payloads, public.ai_action_outcomes from anon, authenticated;
grant select on public.ai_calls, public.ai_action_outcomes to authenticated;

-- ---- Views ------------------------------------------------------------------
-- security_invoker: the view runs with the caller's RLS, so a signed-in user
-- sees only their own rows; the service role / SQL editor sees everything.

-- One row per user action (a build, a Re-simulate, a chat message...). Join a
-- version to its cost with:  ... where action_id = '<version.actionId>'
create or replace view public.ai_action_usage with (security_invoker = true) as
select
  c.action_id,
  c.user_id,
  max(c.project_id::text)::uuid                                  as project_id,
  max(c.action)                                                  as action,
  min(c.created_at)                                              as started_at,
  count(*)                                                       as calls,
  count(*) filter (where c.attempt > 0)                          as retries,
  count(*) filter (where c.outcome <> 'ok')                      as failed_attempts,
  coalesce(sum(c.input_tokens), 0)                               as input_tokens,
  coalesce(sum(c.output_tokens), 0)                              as output_tokens,
  coalesce(sum(c.cache_creation_input_tokens), 0)                as cache_creation_input_tokens,
  coalesce(sum(c.cache_read_input_tokens), 0)                    as cache_read_input_tokens,
  sum(c.cost_usd)                                                as cost_usd,
  bool_and(c.cost_usd is not null or c.outcome = 'error')        as cost_complete,
  sum(c.cache_savings_usd)                                       as cache_savings_usd,
  sum(c.duration_ms)                                             as total_call_ms,
  (select array_agg(distinct o.reason) from public.ai_action_outcomes o where o.action_id = c.action_id) as discarded_reasons
from public.ai_calls c
group by c.action_id, c.user_id;

-- Per inference step and model: where cost, retries and latency actually come from.
create or replace view public.ai_label_stats with (security_invoker = true) as
select
  c.label,
  c.model,
  count(*)                                                        as calls,
  round(100.0 * count(*) filter (where c.attempt > 0) / count(*), 1)   as retry_pct,
  round(100.0 * count(*) filter (where c.outcome <> 'ok') / count(*), 1) as failed_pct,
  round(100.0 * count(*) filter (where c.stop_reason = 'max_tokens') / count(*), 1) as truncated_pct,
  round(100.0 * coalesce(sum(c.cache_read_input_tokens), 0)
        / nullif(coalesce(sum(c.input_tokens), 0) + coalesce(sum(c.cache_creation_input_tokens), 0)
                 + coalesce(sum(c.cache_read_input_tokens), 0), 0), 1) as cache_hit_pct,
  round(avg(c.duration_ms))                                       as avg_ms,
  round(coalesce(sum(c.output_tokens), 0)::numeric / count(*))    as avg_output_tokens,
  sum(c.cost_usd)                                                 as cost_usd
from public.ai_calls c
group by c.label, c.model;

grant select on public.ai_action_usage, public.ai_label_stats to authenticated;

-- ---- Admin dashboard ----------------------------------------------------------
-- One round trip for everything /admin/usage shows, over the last `p_days` days
-- (UTC). Reads ALL users' usage, so it is callable only by the service role: the
-- page checks the signed-in user against ADMIN_EMAILS before ever calling it.
create or replace function public.ai_admin_dashboard(p_days int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with win as (
    select * from ai_calls where created_at >= now() - make_interval(days => greatest(p_days, 1))
  ),
  actions as (
    select
      action_id,
      max(user_id::text)::uuid                                as user_id,
      max(project_id::text)::uuid                             as project_id,
      max(action)                                             as action,
      min(created_at)                                         as started_at,
      count(*)                                                as calls,
      count(*) filter (where attempt > 0)                     as retries,
      count(*) filter (where outcome <> 'ok')                 as failed_attempts,
      sum(cost_usd)                                           as cost_usd,
      bool_and(cost_usd is not null or outcome = 'error')     as cost_complete,
      sum(duration_ms)                                        as total_ms
    from win
    group by action_id
  ),
  reasons as (
    select action_id, array_agg(distinct reason order by reason) as reasons
    from ai_action_outcomes
    where action_id in (select action_id from actions)
    group by action_id
  )
  select jsonb_build_object(
    'days', greatest(p_days, 1),

    'totals', (
      select jsonb_build_object(
        'cost_usd',                    coalesce(sum(cost_usd), 0),
        'calls',                       count(*),
        'actions',                     (select count(*) from actions),
        'users',                       count(distinct user_id),
        'input_tokens',                coalesce(sum(input_tokens), 0),
        'output_tokens',               coalesce(sum(output_tokens), 0),
        'cache_read_input_tokens',     coalesce(sum(cache_read_input_tokens), 0),
        'cache_creation_input_tokens', coalesce(sum(cache_creation_input_tokens), 0),
        'cache_savings_usd',           coalesce(sum(cache_savings_usd), 0),
        'retry_calls',                 count(*) filter (where attempt > 0),
        'failed_calls',                count(*) filter (where outcome <> 'ok'),
        'truncated_calls',             count(*) filter (where stop_reason = 'max_tokens'),
        'unpriced_calls',              count(*) filter (where cost_usd is null and outcome <> 'error'),
        'avg_ms',                      coalesce(round(avg(duration_ms)), 0),
        -- Actions with ANY outcome report, each counted once (`wasted` below splits by reason,
        -- so an action with two reasons appears in both rows).
        'wasted_actions',              (select count(*) from actions where action_id in (select action_id from reasons)),
        'wasted_cost_usd',             (select coalesce(sum(cost_usd), 0) from actions where action_id in (select action_id from reasons)),
        -- What the calls that did NOT produce a usable result cost: failed
        -- validation, no tool call, request errors. This is the retry bill.
        'failed_cost_usd',             coalesce(sum(cost_usd) filter (where outcome <> 'ok'), 0)
      ) from win
    ),

    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'cost_usd', d.cost_usd, 'wasted_usd', d.wasted_usd, 'calls', d.calls) order by d.day), '[]'::jsonb)
      from (
        select (created_at at time zone 'UTC')::date as day, coalesce(sum(cost_usd), 0) as cost_usd,
               coalesce(sum(cost_usd) filter (where outcome <> 'ok'), 0) as wasted_usd, count(*) as calls
        from win group by 1
      ) d
    ),

    'by_action', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', a.action, 'actions', a.actions, 'calls', a.calls, 'cost_usd', a.cost_usd,
        'avg_cost_usd', a.cost_usd / nullif(a.actions, 0), 'avg_ms', a.avg_ms, 'retries', a.retries
      ) order by a.cost_usd desc nulls last), '[]'::jsonb)
      from (
        select action, count(*) as actions, sum(calls) as calls, coalesce(sum(cost_usd), 0) as cost_usd,
               round(avg(total_ms)) as avg_ms, sum(retries) as retries
        from actions group by action
      ) a
    ),

    'by_label', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'label', l.label, 'model', l.model, 'calls', l.calls, 'cost_usd', l.cost_usd, 'wasted_usd', l.wasted_usd,
        'retry_pct', l.retry_pct, 'failed_pct', l.failed_pct, 'truncated_pct', l.truncated_pct,
        'cache_hit_pct', l.cache_hit_pct, 'avg_ms', l.avg_ms, 'avg_output_tokens', l.avg_output_tokens
      ) order by l.cost_usd desc nulls last, l.calls desc), '[]'::jsonb)
      from (
        select label, model, count(*) as calls, sum(cost_usd) as cost_usd,
               coalesce(sum(cost_usd) filter (where outcome <> 'ok'), 0) as wasted_usd,
               round(100.0 * count(*) filter (where attempt > 0) / count(*), 1) as retry_pct,
               round(100.0 * count(*) filter (where outcome <> 'ok') / count(*), 1) as failed_pct,
               round(100.0 * count(*) filter (where stop_reason = 'max_tokens') / count(*), 1) as truncated_pct,
               round(100.0 * coalesce(sum(cache_read_input_tokens), 0)
                     / nullif(coalesce(sum(input_tokens), 0) + coalesce(sum(cache_creation_input_tokens), 0)
                              + coalesce(sum(cache_read_input_tokens), 0), 0), 1) as cache_hit_pct,
               round(avg(duration_ms)) as avg_ms,
               round(coalesce(sum(output_tokens), 0)::numeric / count(*)) as avg_output_tokens
        from win group by label, model
      ) l
    ),

    'top_users', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', u.user_id, 'actions', u.actions, 'calls', u.calls, 'cost_usd', u.cost_usd
      ) order by u.cost_usd desc nulls last), '[]'::jsonb)
      from (
        select user_id, count(*) as actions, sum(calls) as calls, coalesce(sum(cost_usd), 0) as cost_usd
        from actions group by user_id order by 4 desc nulls last limit 10
      ) u
    ),

    'top_projects', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'project_id', p.project_id, 'user_id', p.user_id, 'actions', p.actions, 'calls', p.calls, 'cost_usd', p.cost_usd
      ) order by p.cost_usd desc nulls last), '[]'::jsonb)
      from (
        select project_id, max(user_id::text)::uuid as user_id, count(*) as actions, sum(calls) as calls,
               coalesce(sum(cost_usd), 0) as cost_usd
        from actions where project_id is not null
        group by project_id order by 5 desc nulls last limit 10
      ) p
    ),

    'top_actions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action_id', t.action_id, 'user_id', t.user_id, 'project_id', t.project_id, 'action', t.action,
        'started_at', t.started_at, 'calls', t.calls, 'retries', t.retries, 'failed_attempts', t.failed_attempts,
        'cost_usd', t.cost_usd, 'cost_complete', t.cost_complete, 'total_ms', t.total_ms, 'discarded_reasons', t.reasons
      ) order by t.cost_usd desc nulls last), '[]'::jsonb)
      from (
        select a.*, r.reasons from actions a left join reasons r using (action_id)
        order by a.cost_usd desc nulls last limit 10
      ) t
    ),

    'wasted', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reason', w.reason, 'actions', w.actions, 'cost_usd', w.cost_usd
      ) order by w.cost_usd desc nulls last), '[]'::jsonb)
      from (
        select r.reason, count(*) as actions, coalesce(sum(a.cost_usd), 0) as cost_usd
        from actions a
        join (select distinct action_id, reason from ai_action_outcomes) r using (action_id)
        group by r.reason
      ) w
    ),

    'recent_failures', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'created_at', f.created_at, 'label', f.label, 'model', f.model, 'outcome', f.outcome,
        'attempt', f.attempt, 'action', f.action, 'error', left(f.error, 300), 'stop_reason', f.stop_reason
      ) order by f.created_at desc), '[]'::jsonb)
      from (select * from win where outcome <> 'ok' order by created_at desc limit 20) f
    )
  );
$$;

revoke execute on function public.ai_admin_dashboard(int) from public, anon, authenticated;

-- ---- Retention ---------------------------------------------------------------
-- Payloads hold the user's own prompts and the model's responses. Delete them
-- after `retention`; the metrics row in ai_calls stays. Schedule it (needs the
-- pg_cron extension: Dashboard → Database → Extensions), or run it by hand:
--   select cron.schedule('purge-ai-payloads', '17 3 * * *', $$select public.purge_ai_call_payloads()$$);
create or replace function public.purge_ai_call_payloads(retention interval default interval '30 days')
returns bigint
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.ai_call_payloads where created_at < now() - retention returning 1
  )
  select count(*) from gone;
$$;

revoke execute on function public.purge_ai_call_payloads(interval) from public, anon, authenticated;

-- ---- Recomputing cost --------------------------------------------------------
-- cost_usd is derived from the stored token counts and stamped with price_version.
-- When a price changes (or a model's price was unknown at the time), backfill, e.g.
-- for $3 / $15 per million tokens (cache writes 1.25x, cache reads 0.1x input):
--   update public.ai_calls set
--     cost_usd = (coalesce(input_tokens,0) * 3 + coalesce(cache_creation_input_tokens,0) * 3 * 1.25
--                 + coalesce(cache_read_input_tokens,0) * 3 * 0.1 + coalesce(output_tokens,0) * 15) / 1e6,
--     cache_savings_usd = coalesce(cache_read_input_tokens,0) * 3 * 0.9 / 1e6
--   where model = '<model id>' and input_tokens is not null;
