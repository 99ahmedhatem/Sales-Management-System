do $$
begin
  if to_regclass('public.deals') is null
    or to_regclass('public.leads') is null
    or to_regclass('public.packages') is null
    or to_regclass('public.users') is null
    or to_regprocedure('public.my_role()') is null
  then
    raise exception 'Run the deals and package migrations before this migration';
  end if;
end;
$$;

create table if not exists public.contract_reviews (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  contract_paths text[] not null
    check (cardinality(contract_paths) between 1 and 10),
  submitted_by uuid not null references public.users(id),
  requested_by uuid not null references public.users(id),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'passed', 'needs_attention', 'failed')),
  extracted jsonb not null default '{}'::jsonb,
  mismatches jsonb not null default '[]'::jsonb,
  summary text,
  model text,
  error text,
  processing_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contract_reviews_deal_created_idx
  on public.contract_reviews (deal_id, created_at desc);

create unique index if not exists contract_reviews_one_processing_per_deal_idx
  on public.contract_reviews (deal_id)
  where status in ('queued', 'processing');

alter table public.contract_reviews enable row level security;

drop policy if exists "contract reviews visible to deal participants" on public.contract_reviews;
create policy "contract reviews visible to deal participants"
  on public.contract_reviews for select
  to authenticated
  using (
    exists (
      select 1 from public.deals d
      where d.id = contract_reviews.deal_id
    )
  );

revoke all on public.contract_reviews from anon, authenticated;
grant select on public.contract_reviews to authenticated;
grant select, insert, update on public.contract_reviews to service_role;

create or replace function public.create_contract_review(
  target_deal_id uuid,
  target_contract_paths text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  created_review_id uuid;
begin
  select u.role into caller_role
  from public.users u
  where u.id = auth.uid()
    and u.status = 'active';

  if caller_role is null or caller_role not in ('sales', 'telesales') then
    raise exception 'Only active sales or telesales users can attach a contract';
  end if;

  if target_deal_id is null
    or target_contract_paths is null
    or cardinality(target_contract_paths) not between 1 and 10
    or exists (
      select 1
      from unnest(target_contract_paths) as paths(file_path)
      where file_path is null
        or file_path not like target_deal_id::text || '/%'
        or cardinality(string_to_array(file_path, '/')) <> 2
        or file_path like '%..%'
        or position(chr(92) in file_path) > 0
    )
  then
    raise exception 'Contract files must be stored under the deal folder';
  end if;

  if not exists (select 1 from public.deals d where d.id = target_deal_id) then
    raise exception 'Deal not found';
  end if;

  update public.contract_reviews
  set status = 'failed',
      error = 'Contract review timed out before completion',
      completed_at = now(),
      updated_at = now()
  where deal_id = target_deal_id
    and status in ('queued', 'processing')
    and (
      processing_started_at is null
      or processing_started_at <= now() - interval '3 minutes'
    );

  if exists (
    select 1 from public.contract_reviews r
    where r.deal_id = target_deal_id
      and r.status in ('queued', 'processing')
  ) then
    raise exception 'A contract review is already processing';
  end if;

  insert into public.contract_reviews (
    deal_id, contract_paths, submitted_by, requested_by,
    status, processing_started_at
  )
  values (
    target_deal_id, target_contract_paths, auth.uid(), auth.uid(),
    'queued', now()
  )
  returning id into created_review_id;

  return created_review_id;
end;
$$;

create or replace function public.request_contract_review(target_deal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  deal_row public.deals%rowtype;
  latest_review public.contract_reviews%rowtype;
  new_review_id uuid;
begin
  select u.role into caller_role
  from public.users u
  where u.id = auth.uid()
    and u.status = 'active';

  if caller_role is null
    or caller_role not in ('sales', 'telesales', 'admin', 'manager')
  then
    raise exception 'You are not allowed to request a contract review';
  end if;

  select * into deal_row
  from public.deals d
  where d.id = target_deal_id;
  if not found or deal_row.contract_path is null then
    raise exception 'Upload a contract before requesting a review';
  end if;
  if deal_row.status in ('approved', 'active', 'cancelled') then
    raise exception 'Cannot review a deal after it has been approved';
  end if;

  select * into latest_review
  from public.contract_reviews r
  where r.deal_id = target_deal_id
  order by r.created_at desc, r.id desc
  limit 1;

  if not found then
    raise exception 'Upload a contract before requesting a review';
  end if;
  if caller_role <> 'admin'
    and latest_review.submitted_by <> auth.uid()
    and not exists (
      select 1
      from public.users team_member
      where team_member.id = latest_review.submitted_by
        and team_member.manager_id = auth.uid()
    )
  then
    raise exception 'You can only request reviews for your own deals or your team';
  end if;
  if latest_review.status in ('queued', 'processing') then
    if latest_review.processing_started_at is not null
      and latest_review.processing_started_at > now() - interval '3 minutes'
    then
      raise exception 'A contract review is already processing';
    end if;

    update public.contract_reviews
    set status = 'failed',
        error = 'Contract review timed out before completion',
        completed_at = now(),
        updated_at = now()
    where id = latest_review.id;
  end if;
  insert into public.contract_reviews (
    deal_id, contract_paths, submitted_by, requested_by,
    status, processing_started_at
  )
  values (
    latest_review.deal_id, latest_review.contract_paths,
    latest_review.submitted_by, auth.uid(), 'queued', now()
  )
  returning id into new_review_id;

  return new_review_id;
end;
$$;

revoke all on function public.create_contract_review(uuid, text[]) from public, anon, authenticated;
revoke all on function public.request_contract_review(uuid) from public;
grant execute on function public.request_contract_review(uuid) to authenticated;

drop function if exists public.attach_contract(uuid, text);
create function public.attach_contract(
  target_deal_id uuid,
  target_contract_path text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  deal_row public.deals%rowtype;
  review_id uuid;
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

  select * into deal_row
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found or deal_row.closed_by_user_id is distinct from auth.uid() then
    raise exception 'You can only attach contracts to deals you created';
  end if;
  if deal_row.status in ('approved', 'active', 'cancelled') then
    raise exception 'Cannot change the contract after the deal has been approved';
  end if;

  update public.deals
  set contract_path = target_contract_path,
      status = 'contract_uploaded',
      updated_at = now()
  where id = target_deal_id;

  review_id := public.create_contract_review(
    target_deal_id,
    array[target_contract_path]
  );
  return review_id;
end;
$$;

create or replace function public.complete_contract_review(
  target_review_id uuid,
  target_status text,
  extracted_data jsonb,
  mismatch_data jsonb,
  review_summary text,
  model_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  review_row public.contract_reviews%rowtype;
  deal_row public.deals%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the contract review service can complete reviews';
  end if;
  if target_status is null or target_status not in ('passed', 'needs_attention') then
    raise exception 'Invalid completed contract review status';
  end if;

  select * into review_row
  from public.contract_reviews r
  where r.id = target_review_id
  for update;
  if not found or review_row.status <> 'processing' then
    raise exception 'Contract review is not processing';
  end if;
  select * into deal_row
  from public.deals d
  where d.id = review_row.deal_id
  for update;
  if not found or deal_row.status not in ('contract_uploaded', 'pending_approval') then
    raise exception 'Deal cannot enter approval from its current status';
  end if;

  update public.contract_reviews
  set status = target_status,
      extracted = coalesce(extracted_data, '{}'::jsonb),
      mismatches = coalesce(mismatch_data, '[]'::jsonb),
      summary = review_summary,
      model = model_name,
      error = null,
      completed_at = now(),
      updated_at = now()
  where id = target_review_id;

  update public.deals
  set status = case
        when target_status = 'passed' then 'pending_approval'
        else 'contract_uploaded'
      end,
      updated_at = now()
  where id = deal_row.id;
end;
$$;

create or replace function public.fail_contract_review(
  target_review_id uuid,
  model_name text,
  error_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  review_row public.contract_reviews%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the contract review service can fail reviews';
  end if;
  if nullif(trim(error_message), '') is null then
    raise exception 'A failure reason is required';
  end if;

  select * into review_row
  from public.contract_reviews r
  where r.id = target_review_id
  for update;
  if not found then
    raise exception 'Contract review not found';
  end if;
  if review_row.status not in ('queued', 'processing') then
    raise exception 'Only an in-progress contract review can fail';
  end if;

  update public.contract_reviews
  set status = 'failed',
      error = left(error_message, 4000),
      model = model_name,
      completed_at = now(),
      updated_at = now()
  where id = target_review_id;

  update public.deals
  set status = 'contract_uploaded',
      updated_at = now()
  where id = review_row.deal_id
    and status = 'pending_approval';
end;
$$;

alter table public.deals
  add column if not exists approved_by uuid references public.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists approval_override_reason text;

create or replace function public.approve_deal(
  target_deal_id uuid,
  override_reason_text text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_status text;
  deal_row public.deals%rowtype;
  latest_review public.contract_reviews%rowtype;
  override_reason text;
  override_words integer;
begin
  select u.role, u.status into caller_role, caller_status
  from public.users u
  where u.id = auth.uid();
  if caller_role is null
    or caller_role not in ('admin', 'manager')
    or caller_status is distinct from 'active'
  then
    raise exception 'Only an active admin or manager can approve deals';
  end if;

  select * into deal_row
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found or deal_row.status not in ('contract_uploaded', 'pending_approval') then
    raise exception 'Deal is not waiting for approval';
  end if;
  if deal_row.contract_path is null then
    raise exception 'Upload a signed contract before approving this deal';
  end if;
  if caller_role = 'manager' and not exists (
    select 1 from public.users team_member
    where team_member.manager_id = auth.uid()
      and team_member.id in (deal_row.sales_user_id, deal_row.telesales_user_id)
  ) then
    raise exception 'You can only approve deals from your team';
  end if;

  select * into latest_review
  from public.contract_reviews r
  where r.deal_id = target_deal_id
  order by r.created_at desc, r.id desc
  limit 1;
  if not found then
    raise exception 'Complete the contract review before approving this deal';
  end if;
  if latest_review.status in ('queued', 'processing') then
    raise exception 'Wait for the current contract review to finish';
  end if;

  if latest_review.status <> 'passed' then
    if caller_role <> 'admin' then
      raise exception 'The latest contract review must pass before approval';
    end if;
    override_reason := trim(coalesce(override_reason_text, ''));
    override_words := cardinality(regexp_split_to_array(override_reason, '\s+'));
    if override_reason = '' or override_words < 5 then
      raise exception 'Admin override requires a written reason of at least five words';
    end if;
  end if;

  update public.deals
  set status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      approval_override_reason = case
        when latest_review.status = 'passed' then null
        else override_reason
      end,
      updated_at = now()
  where id = target_deal_id;
end;
$$;

revoke all on function public.attach_contract(uuid, text) from public, anon;
revoke all on function public.complete_contract_review(uuid, text, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.fail_contract_review(uuid, text, text) from public, anon, authenticated;
revoke all on function public.approve_deal(uuid, text) from public, anon;
grant execute on function public.attach_contract(uuid, text) to authenticated;
grant execute on function public.complete_contract_review(uuid, text, jsonb, jsonb, text, text) to service_role;
grant execute on function public.fail_contract_review(uuid, text, text) to service_role;
grant execute on function public.approve_deal(uuid, text) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.contract_reviews;
  exception when duplicate_object then
    null;
  end;
end;
$$;

notify pgrst, 'reload schema';
