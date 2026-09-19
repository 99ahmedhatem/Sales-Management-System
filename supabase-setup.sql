-- Run this once in Supabase SQL Editor.

alter table public.leads
  add column if not exists is_salla_store boolean not null default false;

alter table public.leads
  add column if not exists data_quality text not null default 'normal'
  check (data_quality in ('high', 'medium', 'normal'));

create table if not exists public.client_comments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  text text not null check (char_length(trim(text)) > 0),
  created_at timestamptz not null default now()
);

alter table public.client_comments enable row level security;

create policy "Authenticated users can read client comments"
  on public.client_comments for select
  to authenticated using (true);

create policy "Authenticated users can add client comments"
  on public.client_comments for insert
  to authenticated with check (auth.uid() = author_id);

create or replace function public.delete_user_account(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only admins can delete users';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'The current admin cannot delete their own account';
  end if;

  delete from auth.users where id = target_user_id;
end;
$$;

grant execute on function public.delete_user_account(uuid) to authenticated;

-- Refresh PostgREST so the browser can see the function immediately.
notify pgrst, 'reload schema';

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'Managers can read their team') then
    create policy "Managers can read their team"
      on public.users for select
      to authenticated
      using (id = auth.uid() or manager_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leads' and policyname = 'Managers can read team leads') then
    create policy "Managers can read team leads"
      on public.leads for select
      to authenticated
      using (
        assigned_to = auth.uid()
        or exists (
          select 1 from public.users team_member
          where team_member.id = leads.assigned_to
            and team_member.manager_id = auth.uid()
        )
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leads' and policyname = 'Managers can assign team leads') then
    create policy "Managers can assign team leads"
      on public.leads for update
      to authenticated
      using (
        assigned_to = auth.uid()
        or exists (
          select 1 from public.users team_member
          where team_member.id = leads.assigned_to
            and team_member.manager_id = auth.uid()
        )
      )
      with check (
        assigned_to = auth.uid()
        or exists (
          select 1 from public.users team_member
          where team_member.id = leads.assigned_to
            and team_member.manager_id = auth.uid()
        )
      );
  end if;
end $$;
