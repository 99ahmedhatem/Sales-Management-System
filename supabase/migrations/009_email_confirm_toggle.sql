create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  email text,
  full_name text,
  role text check (role in ('admin', 'manager', 'sales', 'telesales')) default 'sales',
  status text check (status in ('active', 'inactive')) default 'active',
  manager_id uuid references public.users(id),
  commission_percent numeric(5,2) not null default 0 check (commission_percent between 0 and 100),
  last_login timestamptz,
  email_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users
  add column if not exists username text;

alter table public.users
  add column if not exists email text;

alter table public.users
  add column if not exists full_name text;

alter table public.users
  add column if not exists role text check (role in ('admin', 'manager', 'sales', 'telesales')) default 'sales';

alter table public.users
  add column if not exists status text check (status in ('active', 'inactive')) default 'active';

alter table public.users
  add column if not exists manager_id uuid references public.users(id);

alter table public.users
  add column if not exists commission_percent numeric(5,2) not null default 0 check (commission_percent between 0 and 100);

alter table public.users
  add column if not exists last_login timestamptz;

alter table public.users
  add column if not exists email_confirmed boolean not null default false;

alter table public.users
  add column if not exists created_at timestamptz not null default now();

alter table public.users
  add column if not exists updated_at timestamptz not null default now();

alter table public.users
  alter column username set default null;

alter table public.users
  alter column full_name set default null;

alter table public.users
  alter column email set default null;

create unique index if not exists users_username_unique
  on public.users (lower(username))
  where username is not null;

create unique index if not exists users_email_unique
  on public.users (lower(email))
  where email is not null;

alter table public.users enable row level security;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.users (id, username, email, full_name, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'employee_code', 'EMP-' || substr(md5(new.id::text), 1, 8)),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    'sales',
    'active'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.users.full_name, excluded.full_name),
        updated_at = now();

  return new;
end;
$$;

create or replace function public.list_email_confirmations()
returns table (id uuid, confirmed boolean)
language sql
security definer
set search_path = public
as $$
  select u.id, coalesce(u.email_confirmed, false) as confirmed
  from public.users u
  where exists (
    select 1
    from public.users admin_user
    where admin_user.id = auth.uid()
      and admin_user.role = 'admin'
  )
  order by u.full_name nulls last;
$$;

create or replace function public.set_user_email_confirmed(target_user_id uuid, should_confirm boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only admins can change email confirmation status';
  end if;

  update public.users
  set email_confirmed = should_confirm,
      updated_at = now()
  where id = target_user_id;
end;
$$;

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'Users can read their own profile'
  ) then
    create policy "Users can read their own profile"
      on public.users for select
      to authenticated
      using (id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'Admins can read all user profiles'
  ) then
    create policy "Admins can read all user profiles"
      on public.users for select
      to authenticated
      using (exists (select 1 from public.users admin_user where admin_user.id = auth.uid() and admin_user.role = 'admin'));
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'Managers can read their team'
  ) then
    create policy "Managers can read their team"
      on public.users for select
      to authenticated
      using (id = auth.uid() or manager_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'Users can insert their own profile'
  ) then
    create policy "Users can insert their own profile"
      on public.users for insert
      to authenticated
      with check (id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'Admins can update user profiles'
  ) then
    create policy "Admins can update user profiles"
      on public.users for update
      to authenticated
      using (exists (select 1 from public.users admin_user where admin_user.id = auth.uid() and admin_user.role = 'admin'))
      with check (exists (select 1 from public.users admin_user where admin_user.id = auth.uid() and admin_user.role = 'admin'));
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'Users can update their own profile'
  ) then
    create policy "Users can update their own profile"
      on public.users for update
      to authenticated
      using (id = auth.uid())
      with check (id = auth.uid());
  end if;
end $$;

grant execute on function public.list_email_confirmations() to authenticated;
grant execute on function public.set_user_email_confirmed(uuid, boolean) to authenticated;
grant execute on function public.delete_user_account(uuid) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.users;
  exception when duplicate_object then
    null;
  end;
end $$;

notify pgrst, 'reload schema';
