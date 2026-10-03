create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) > 0),
  description text,
  features text[] not null default '{}'::text[],
  duration_months integer not null check (duration_months > 0),
  price_sar numeric(12, 2) not null check (price_sar >= 0),
  min_price_sar numeric(12, 2) not null check (min_price_sar >= 0 and min_price_sar <= price_sar),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.packages enable row level security;

drop policy if exists "Authenticated users can read active packages" on public.packages;
create policy "Authenticated users can read active packages"
  on public.packages for select
  to authenticated
  using (
    is_active
    or exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

drop policy if exists "Admins can manage packages" on public.packages;
create policy "Admins can manage packages"
  on public.packages for all
  to authenticated
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );
