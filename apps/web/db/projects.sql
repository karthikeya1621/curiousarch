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

-- Abuse limits. The anon key is public and a guest is a real authenticated user, so a script can call the API
-- directly, bypassing the app, and insert as much as row-level security allows (which is anything, for its own rows).
-- `not valid`: checked on every new write, existing rows are left alone. 4 MB is far above a real project.
alter table public.projects drop constraint if exists projects_data_size;
alter table public.projects add constraint projects_data_size check (pg_column_size(data) < 4000000) not valid;

-- At most 3 projects for a guest (the app allows 1), 200 for anyone else.
create or replace function public.projects_limit_rows() returns trigger
language plpgsql set search_path = public as $$
declare
  v_cap int := case when coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then 3 else 200 end;
begin
  if (select count(*) from public.projects where user_id = new.user_id) >= v_cap then
    raise exception 'project limit reached' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists projects_limit_rows on public.projects;
create trigger projects_limit_rows before insert on public.projects
  for each row execute function public.projects_limit_rows();
