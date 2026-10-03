do $$
begin
  if to_regclass('public.leads') is null
    or to_regclass('public.packages') is null
    or to_regclass('public.users') is null
    or to_regclass('public.meetings') is null
  then
    raise exception 'Run the leads, packages, and meeting migrations before this migration';
  end if;
end;
$$;

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id),
  package_id uuid not null references public.packages(id),
  sales_user_id uuid references public.users(id),
  telesales_user_id uuid not null references public.users(id),
  closed_by_user_id uuid not null references public.users(id),
  package_name text not null,
  package_duration_months integer not null check (package_duration_months > 0),
  list_price_sar numeric(12, 2) not null check (list_price_sar >= 0),
  min_price_sar numeric(12, 2) not null check (min_price_sar >= 0),
  price_sar numeric(12, 2) not null check (price_sar >= 0),
  below_min_price boolean not null default false,
  start_date date not null,
  end_date date not null,
  notes text,
  recording_path text,
  contract_path text,
  status text not null default 'draft'
    check (status in ('draft', 'contract_uploaded', 'pending_approval', 'approved', 'active', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (min_price_sar <= list_price_sar)
);

create index if not exists deals_created_at_idx
  on public.deals (created_at desc);
create index if not exists deals_sales_user_created_idx
  on public.deals (sales_user_id, created_at desc);
create index if not exists deals_telesales_user_created_idx
  on public.deals (telesales_user_id, created_at desc);
create index if not exists deals_lead_id_idx on public.deals (lead_id);

alter table public.deals enable row level security;

drop policy if exists "Deal participants can read deals" on public.deals;
create policy "Deal participants can read deals"
  on public.deals for select
  to authenticated
  using (
    public.my_role() = 'admin'
    or sales_user_id = auth.uid()
    or telesales_user_id = auth.uid()
    or exists (
      select 1
      from public.users team_member
      where team_member.manager_id = auth.uid()
        and team_member.id in (deals.sales_user_id, deals.telesales_user_id)
    )
  );

revoke insert, update, delete on public.deals from anon, authenticated;
grant select on public.deals to authenticated;

create or replace function public.create_deal(
  target_lead_id uuid,
  target_package_id uuid,
  target_price_sar numeric,
  target_start_date date,
  deal_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_status text;
  lead_owner uuid;
  assigned_sales uuid;
  pkg public.packages%rowtype;
  created_deal_id uuid;
begin
  select u.role, u.status into caller_role, caller_status
  from public.users u
  where u.id = auth.uid();

  if caller_role is null
    or caller_role not in ('sales', 'telesales')
    or caller_status is distinct from 'active'
  then
    raise exception 'Only active sales or telesales users can create deals';
  end if;
  if target_price_sar is null or target_price_sar < 0 then
    raise exception 'Enter a valid closing price in SAR';
  end if;
  if target_start_date is null then
    raise exception 'Choose a deal start date';
  end if;

  select l.assigned_to into lead_owner
  from public.leads l
  where l.id = target_lead_id
  for share;
  if not found or lead_owner is null then
    raise exception 'Lead not found or not assigned to telesales';
  end if;
  if not exists (
    select 1 from public.users u
    where u.id = lead_owner and u.role = 'telesales'
  ) then
    raise exception 'The lead owner must be a telesales user';
  end if;

  if caller_role = 'telesales' then
    if lead_owner is distinct from auth.uid() then
      raise exception 'You can only close deals for leads assigned to you';
    end if;
  else
    select m.assigned_sales_id into assigned_sales
    from public.meetings m
    where m.lead_id = target_lead_id
      and m.assigned_sales_id = auth.uid()
    order by m.proposed_date desc
    limit 1;
    if assigned_sales is null then
      raise exception 'You can only close a deal for a lead assigned to you through a meeting';
    end if;
  end if;

  select * into pkg
  from public.packages p
  where p.id = target_package_id
    and p.is_active = true;
  if not found then
    raise exception 'Choose an active package';
  end if;

  insert into public.deals (
    lead_id, package_id, sales_user_id, telesales_user_id, closed_by_user_id,
    package_name, package_duration_months, list_price_sar, min_price_sar,
    price_sar, below_min_price, start_date, end_date, notes
  )
  values (
    target_lead_id, target_package_id,
    case when caller_role = 'sales' then auth.uid() else null end,
    lead_owner, auth.uid(),
    pkg.name, pkg.duration_months, pkg.price_sar, pkg.min_price_sar,
    target_price_sar, target_price_sar < pkg.min_price_sar,
    target_start_date,
    (target_start_date + make_interval(months => pkg.duration_months) - interval '1 day')::date,
    nullif(trim(deal_notes), '')
  )
  returning id into created_deal_id;

  return created_deal_id;
end;
$$;

create or replace function public.attach_recording(
  target_deal_id uuid,
  target_recording_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  deal_row public.deals%rowtype;
begin
  select u.role into caller_role
  from public.users u
  where u.id = auth.uid()
    and u.status = 'active';
  if caller_role is null or caller_role not in ('sales', 'telesales') then
    raise exception 'Only sales or telesales users can attach a recording';
  end if;
  if target_recording_path is null
    or target_recording_path not like target_deal_id::text || '/%'
    or cardinality(string_to_array(target_recording_path, '/')) <> 2
    or target_recording_path like '%..%'
    or position(chr(92) in target_recording_path) > 0
  then
    raise exception 'Recording must be stored under the deal folder';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'recordings' and o.name = target_recording_path
  ) then
    raise exception 'Recording file was not uploaded';
  end if;

  select * into deal_row from public.deals d
  where d.id = target_deal_id
  for update;
  if not found
    or deal_row.closed_by_user_id is distinct from auth.uid()
  then
    raise exception 'You can only attach recordings to deals you created';
  end if;
  if deal_row.status = 'cancelled' then
    raise exception 'Cannot attach files to a cancelled deal';
  end if;

  update public.deals
  set recording_path = target_recording_path, updated_at = now()
  where id = target_deal_id;
end;
$$;

create or replace function public.attach_contract(
  target_deal_id uuid,
  target_contract_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  deal_row public.deals%rowtype;
begin
  select u.role into caller_role
  from public.users u
  where u.id = auth.uid()
    and u.status = 'active';
  if caller_role is null or caller_role not in ('sales', 'telesales') then
    raise exception 'Only sales or telesales users can attach a contract';
  end if;
  if target_contract_path is null
    or target_contract_path not like target_deal_id::text || '/%'
    or cardinality(string_to_array(target_contract_path, '/')) <> 2
    or target_contract_path like '%..%'
    or position(chr(92) in target_contract_path) > 0
  then
    raise exception 'Contract must be stored under the deal folder';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'contracts' and o.name = target_contract_path
  ) then
    raise exception 'Contract file was not uploaded';
  end if;

  select * into deal_row from public.deals d
  where d.id = target_deal_id
  for update;
  if not found
    or deal_row.closed_by_user_id is distinct from auth.uid()
  then
    raise exception 'You can only attach contracts to deals you created';
  end if;
  if deal_row.status = 'cancelled' then
    raise exception 'Cannot attach files to a cancelled deal';
  end if;

  update public.deals
  set contract_path = target_contract_path,
      status = 'contract_uploaded',
      updated_at = now()
  where id = target_deal_id;
end;
$$;

revoke all on function public.create_deal(uuid, uuid, numeric, date, text) from public, anon;
revoke all on function public.attach_recording(uuid, text) from public, anon;
revoke all on function public.attach_contract(uuid, text) from public, anon;
grant execute on function public.create_deal(uuid, uuid, numeric, date, text) to authenticated;
grant execute on function public.attach_recording(uuid, text) to authenticated;
grant execute on function public.attach_contract(uuid, text) to authenticated;

insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false), ('contracts', 'contracts', false)
on conflict (id) do update set public = false;

drop policy if exists "Deal participants can read deal files" on storage.objects;
create policy "Deal participants can read deal files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('recordings', 'contracts')
    and cardinality(string_to_array(storage.objects.name, '/')) = 2
    and exists (
      select 1 from public.deals d
      where d.id::text = split_part(storage.objects.name, '/', 1)
    )
  );

drop policy if exists "Deal creators can upload deal files" on storage.objects;
create policy "Deal creators can upload deal files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('recordings', 'contracts')
    and cardinality(string_to_array(storage.objects.name, '/')) = 2
    and exists (
      select 1 from public.deals d
      where d.id::text = split_part(storage.objects.name, '/', 1)
        and d.closed_by_user_id = auth.uid()
    )
  );

do $$
begin
  begin
    alter publication supabase_realtime add table public.deals;
  exception when duplicate_object then
    null;
  end;
end;
$$;

notify pgrst, 'reload schema';
