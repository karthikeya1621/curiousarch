-- Saved projects — run once in the Supabase SQL editor (Dashboard → SQL). Idempotent: safe to re-run.
-- Exported from the live schema (Sep 2026) so a fresh production project can be set up from the repo.
--
-- One row per project; the whole model, versions, findings, queued changes and chat live in `data`
-- (jsonb), so the shape can evolve without migrations. `updated_at` is set by the app, not a trigger.
-- Row-level security: a user can only ever see and change their own rows. Deleting an auth user
-- (including a purged guest — see guest-trial.sql) deletes their projects (on delete cascade).

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null default '',
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects (user_id);

alter table public.projects enable row level security;

drop policy if exists "select own projects" on public.projects;
create policy "select own projects" on public.projects for select using (auth.uid() = user_id);

drop policy if exists "insert own projects" on public.projects;
create policy "insert own projects" on public.projects for insert with check (auth.uid() = user_id);

drop policy if exists "update own projects" on public.projects;
create policy "update own projects" on public.projects for update using (auth.uid() = user_id);

drop policy if exists "delete own projects" on public.projects;
create policy "delete own projects" on public.projects for delete using (auth.uid() = user_id);
