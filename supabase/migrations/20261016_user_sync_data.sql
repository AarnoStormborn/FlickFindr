-- Accounts + cloud sync snapshot.
--
-- Apply in the Supabase SQL Editor if the developer connection pooler cannot reach
-- the project, or via `DATABASE_URL=<...> npm run init:db` (the application migration
-- is the same and idempotent).

create table if not exists public.user_sync_data (
  user_id uuid primary key,
  data jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'user_sync_data_user_id_fkey'
       and conrelid = 'public.user_sync_data'::regclass
  ) then
    alter table public.user_sync_data
      add constraint user_sync_data_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

alter table public.user_sync_data enable row level security;
drop policy if exists user_sync_data_owner on public.user_sync_data;
create policy user_sync_data_owner on public.user_sync_data
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
grant select, insert, update, delete on public.user_sync_data to authenticated;
