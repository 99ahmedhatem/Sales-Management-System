do $$
begin
  if to_regclass('public.meetings') is null then
    raise exception 'Run the sales-flow SQL that creates public.meetings before this migration';
  end if;
end;
$$;

alter table public.leads
  add column if not exists needs_meeting boolean not null default false;

create table if not exists public.meeting_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  requested_by uuid not null references public.users(id),
  assigned_sales_id uuid not null references public.users(id),
  notes text,
  preferred_date timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  decline_reason text,
  meeting_id uuid unique references public.meetings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meeting_requests_sales_status_created_idx
  on public.meeting_requests (assigned_sales_id, status, created_at desc);

create index if not exists meeting_requests_requester_status_created_idx
  on public.meeting_requests (requested_by, status, created_at desc);

create unique index if not exists meeting_requests_one_pending_per_lead_idx
  on public.meeting_requests (lead_id)
  where status = 'pending';

update public.leads l
set needs_meeting = true
where exists (
  select 1
  from public.meeting_requests r
  where r.lead_id = l.id
    and r.status = 'pending'
);

alter table public.meeting_requests enable row level security;

drop policy if exists "meeting requests read" on public.meeting_requests;
create policy "meeting requests read"
  on public.meeting_requests for select
  to authenticated
  using (
    requested_by = auth.uid()
    or assigned_sales_id = auth.uid()
    or public.my_role() = 'admin'
    or exists (
      select 1
      from public.users u
      where u.manager_id = auth.uid()
        and u.id in (meeting_requests.requested_by, meeting_requests.assigned_sales_id)
    )
  );

drop policy if exists "meetings read" on public.meetings;
create policy "meetings read"
  on public.meetings for select
  to authenticated
  using (
    public.my_role() = 'admin'
    or booked_by = auth.uid()
    or assigned_sales_id = auth.uid()
    or exists (
      select 1
      from public.users u
      where u.manager_id = auth.uid()
        and u.id in (meetings.booked_by, meetings.assigned_sales_id)
    )
  );

drop policy if exists "meetings insert" on public.meetings;
drop policy if exists "meetings update" on public.meetings;
revoke insert, update, delete on public.meetings from authenticated;
revoke insert, update, delete on public.meeting_requests from authenticated;
grant select on public.meetings, public.meeting_requests to authenticated;

drop policy if exists "Sales can read leads through meeting access" on public.leads;
create policy "Sales can read leads through meeting access"
  on public.leads for select
  to authenticated
  using (
    exists (
      select 1
      from public.meeting_requests r
      where r.lead_id = leads.id
        and r.assigned_sales_id = auth.uid()
    )
    or exists (
      select 1
      from public.meetings m
      where m.lead_id = leads.id
        and m.assigned_sales_id = auth.uid()
    )
    or exists (
      select 1
      from public.users manager
      join public.meeting_requests r
        on r.assigned_sales_id = manager.id or r.requested_by = manager.id
      where manager.manager_id = auth.uid()
        and r.lead_id = leads.id
    )
    or exists (
      select 1
      from public.users manager
      join public.meetings m
        on m.assigned_sales_id = manager.id or m.booked_by = manager.id
      where manager.manager_id = auth.uid()
        and m.lead_id = leads.id
    )
  );

do $$
begin
  if to_regprocedure('public.request_meeting(uuid,uuid,text)') is not null then
    drop function public.request_meeting(uuid, uuid, text);
  end if;
end;
$$;

create or replace function public.request_meeting(
  target_lead_id uuid,
  target_sales_id uuid,
  request_notes text default null,
  preferred_meeting_date timestamptz default null
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
  request_id uuid;
begin
  select u.role, u.status into caller_role, caller_status
  from public.users u
  where u.id = auth.uid();

  if caller_role is distinct from 'telesales' or caller_status is distinct from 'active' then
    raise exception 'Only telesales users can request a meeting';
  end if;

  select l.assigned_to into lead_owner
  from public.leads l
  where l.id = target_lead_id
  for update;

  if not found or lead_owner is distinct from auth.uid() then
    raise exception 'You can only request meetings for leads assigned to you';
  end if;

  if not exists (
    select 1 from public.users u
    where u.id = target_sales_id
      and u.role = 'sales'
      and u.status = 'active'
  ) then
    raise exception 'Choose an active sales user';
  end if;
  if preferred_meeting_date is not null and preferred_meeting_date <= now() then
    raise exception 'Preferred meeting time must be in the future';
  end if;

  insert into public.meeting_requests (
    lead_id, requested_by, assigned_sales_id, notes, preferred_date
  )
  values (
    target_lead_id, auth.uid(), target_sales_id,
    nullif(trim(request_notes), ''), preferred_meeting_date
  )
  returning id into request_id;

  update public.leads
  set needs_meeting = true
  where id = target_lead_id;

  insert into public.notifications (user_id, type, title, message)
  select target_sales_id, 'meeting', 'Meeting request',
    'A meeting was requested for ' || l.name || '.'
  from public.leads l
  where l.id = target_lead_id;

  return request_id;
end;
$$;

create or replace function public.accept_meeting_request(
  target_request_id uuid,
  target_proposed_date timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.meeting_requests%rowtype;
  caller_role text;
  caller_status text;
  created_meeting_id uuid;
begin
  select u.role, u.status into caller_role, caller_status
  from public.users u
  where u.id = auth.uid();

  if caller_role is distinct from 'sales' or caller_status is distinct from 'active' then
    raise exception 'Only sales users can accept meeting requests';
  end if;

  if target_proposed_date is null or target_proposed_date <= now() then
    raise exception 'Choose a meeting time in the future';
  end if;

  select * into request_row
  from public.meeting_requests r
  where r.id = target_request_id
  for update;

  if not found or request_row.assigned_sales_id is distinct from auth.uid() then
    raise exception 'This meeting request is not assigned to you';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'This meeting request is no longer pending';
  end if;

  insert into public.meetings (lead_id, booked_by, assigned_sales_id, proposed_date, telesales_notes)
  values (
    request_row.lead_id,
    request_row.requested_by,
    request_row.assigned_sales_id,
    target_proposed_date,
    request_row.notes
  )
  returning id into created_meeting_id;

  update public.meeting_requests
  set status = 'accepted', meeting_id = created_meeting_id, updated_at = now()
  where id = target_request_id;

  update public.leads
  set needs_meeting = false
  where id = request_row.lead_id;

  insert into public.notifications (user_id, type, title, message)
  select request_row.requested_by, 'meeting', 'Meeting scheduled',
    'Your meeting request was accepted.'
  where request_row.requested_by <> auth.uid();

  return created_meeting_id;
end;
$$;

create or replace function public.decline_meeting_request(
  target_request_id uuid,
  decline_reason_text text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_status text;
  request_row public.meeting_requests%rowtype;
begin
  select u.role, u.status into caller_role, caller_status
  from public.users u
  where u.id = auth.uid();

  if caller_role is distinct from 'sales' or caller_status is distinct from 'active' then
    raise exception 'Only sales users can decline meeting requests';
  end if;

  select * into request_row
  from public.meeting_requests r
  where r.id = target_request_id
  for update;

  if not found or request_row.assigned_sales_id is distinct from auth.uid() then
    raise exception 'This meeting request is not assigned to you';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'This meeting request is no longer pending';
  end if;
  if nullif(trim(decline_reason_text), '') is null then
    raise exception 'Provide a reason for declining this meeting request';
  end if;

  update public.meeting_requests
  set status = 'declined',
      decline_reason = nullif(trim(decline_reason_text), ''),
      updated_at = now()
  where id = target_request_id;

  update public.leads
  set needs_meeting = false
  where id = request_row.lead_id;

  insert into public.notifications (user_id, type, title, message)
  select request_row.requested_by, 'meeting', 'Meeting request declined',
    coalesce(nullif(trim(decline_reason_text), ''), 'The sales user declined the request.')
  where request_row.requested_by <> auth.uid();
end;
$$;

create or replace function public.cancel_meeting_request(target_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_status text;
  request_row public.meeting_requests%rowtype;
begin
  select u.role, u.status into caller_role, caller_status
  from public.users u
  where u.id = auth.uid();

  if caller_role is null or caller_status is distinct from 'active' or caller_role not in ('telesales', 'admin', 'manager') then
    raise exception 'You are not allowed to cancel meeting requests';
  end if;

  select * into request_row
  from public.meeting_requests r
  where r.id = target_request_id
  for update;

  if not found then
    raise exception 'Meeting request not found';
  end if;
  if caller_role = 'telesales' and request_row.requested_by is distinct from auth.uid() then
    raise exception 'You can only cancel your own meeting requests';
  end if;
  if caller_role = 'manager' and not exists (
    select 1 from public.users u
    where u.manager_id = auth.uid()
      and u.id in (request_row.requested_by, request_row.assigned_sales_id)
  ) then
    raise exception 'You can only cancel requests involving your team';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'Only pending meeting requests can be cancelled';
  end if;

  update public.meeting_requests
  set status = 'cancelled', updated_at = now()
  where id = target_request_id;

  update public.leads
  set needs_meeting = false
  where id = request_row.lead_id;
end;
$$;

create or replace function public.reassign_meeting_request(
  target_request_id uuid,
  target_sales_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_status text;
  request_row public.meeting_requests%rowtype;
begin
  select u.role, u.status into caller_role, caller_status
  from public.users u
  where u.id = auth.uid();

  if caller_role is null or caller_status is distinct from 'active' or caller_role not in ('admin', 'manager') then
    raise exception 'You are not allowed to reassign meeting requests';
  end if;

  select * into request_row
  from public.meeting_requests r
  where r.id = target_request_id
  for update;

  if not found then
    raise exception 'Meeting request not found';
  end if;
  if caller_role = 'telesales' and request_row.requested_by is distinct from auth.uid() then
    raise exception 'You can only reassign your own meeting requests';
  end if;
  if caller_role = 'manager' and (
    not exists (
      select 1 from public.users u
      where u.manager_id = auth.uid()
        and u.id in (request_row.requested_by, request_row.assigned_sales_id)
    )
    or not exists (
      select 1 from public.users u
      where u.id = target_sales_id
        and u.manager_id = auth.uid()
    )
  ) then
    raise exception 'You can only reassign requests within your team';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'Only pending meeting requests can be reassigned';
  end if;
  if not exists (
    select 1 from public.users u
    where u.id = target_sales_id
      and u.role = 'sales'
      and u.status = 'active'
  ) then
    raise exception 'Choose an active sales user';
  end if;

  update public.meeting_requests
  set assigned_sales_id = target_sales_id, updated_at = now()
  where id = target_request_id;

  insert into public.notifications (user_id, type, title, message)
  values (target_sales_id, 'meeting', 'Meeting request reassigned', 'A meeting request was assigned to you.');
end;
$$;

create or replace function public.update_meeting_outcome(
  target_meeting_id uuid,
  new_outcome text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_status text;
  meeting_row public.meetings%rowtype;
begin
  select u.role, u.status into caller_role, caller_status
  from public.users u
  where u.id = auth.uid();

  if caller_role is null or caller_status is distinct from 'active' or caller_role not in ('sales', 'admin', 'manager') then
    raise exception 'You are not allowed to update meeting outcomes';
  end if;
  if new_outcome is null or new_outcome not in ('Scheduled', 'Deal Closed – Won', 'Deal Lost', 'Rescheduled', 'No-Show') then
    raise exception 'Invalid meeting outcome';
  end if;
  if caller_role = 'sales' and new_outcome not in ('Rescheduled', 'No-Show', 'Deal Lost') then
    raise exception 'Sales can set an outcome to Rescheduled, No-Show, or Deal Lost';
  end if;

  select * into meeting_row
  from public.meetings m
  where m.id = target_meeting_id
  for update;

  if not found then
    raise exception 'Meeting not found';
  end if;
  if caller_role = 'sales' and meeting_row.assigned_sales_id is distinct from auth.uid() then
    raise exception 'You can only update outcomes for your meetings';
  end if;
  if caller_role = 'manager' and not exists (
    select 1 from public.users u
    where u.manager_id = auth.uid()
      and u.id in (meeting_row.booked_by, meeting_row.assigned_sales_id)
  ) then
    raise exception 'You can only update outcomes for your team';
  end if;

  update public.meetings
  set outcome = new_outcome
  where id = target_meeting_id;
end;
$$;

revoke all on function public.request_meeting(uuid, uuid, text, timestamptz) from public;
revoke all on function public.accept_meeting_request(uuid, timestamptz) from public;
revoke all on function public.decline_meeting_request(uuid, text) from public;
revoke all on function public.cancel_meeting_request(uuid) from public;
revoke all on function public.reassign_meeting_request(uuid, uuid) from public;
revoke all on function public.update_meeting_outcome(uuid, text) from public;
grant execute on function public.request_meeting(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.accept_meeting_request(uuid, timestamptz) to authenticated;
grant execute on function public.decline_meeting_request(uuid, text) to authenticated;
grant execute on function public.cancel_meeting_request(uuid) to authenticated;
grant execute on function public.reassign_meeting_request(uuid, uuid) to authenticated;
grant execute on function public.update_meeting_outcome(uuid, text) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.meetings;
  exception when duplicate_object then
    null;
  end;
  begin
    alter publication supabase_realtime add table public.meeting_requests;
  exception when duplicate_object then
    null;
  end;
end;
$$;

notify pgrst, 'reload schema';
