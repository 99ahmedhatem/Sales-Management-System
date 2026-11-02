-- 070: "تواصلت" mark next to each client + counts per employee
--
--   · Every user (telesales, sales, telesales + sales, manager, admin) can mark a client "contacted" — or remove the mark.
--     One mark per person per client: two employees who called the same client both count.
--   · leads.contacted_at / leads.contacted_by = the latest mark on the client (for the Clients filter and "by whom").
--   · contact_stats() = how many clients each person contacted: today, in a period (default: this month), all time.
--     Admin sees everyone, a manager sees himself + his team, everyone else sees himself.
-- Safe to run more than once.

create table if not exists public.lead_contacts (
  lead_id      uuid not null references public.leads(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  contacted_at timestamptz not null default now(),
  primary key (lead_id, user_id)
);
create index if not exists lead_contacts_user_idx on public.lead_contacts (user_id, contacted_at desc);

alter table public.leads add column if not exists contacted_at timestamptz;
alter table public.leads add column if not exists contacted_by uuid;
create index if not exists leads_contacted_at_idx on public.leads (contacted_at);

-- read: your own marks; admin all; a manager his team's. Writing only through set_lead_contact().
alter table public.lead_contacts enable row level security;
drop policy if exists lead_contacts_read on public.lead_contacts;
create policy lead_contacts_read on public.lead_contacts for select to authenticated using (
  user_id = auth.uid()
  or public.my_role() = 'admin'
  or (public.my_role() = 'manager' and user_id in (select u.id from public.users u where u.manager_id = auth.uid()))
);
grant select on public.lead_contacts to authenticated;

/** Mark (p_on = true) or unmark a client as contacted by me. Returns the client's latest contact time. */
create or replace function public.set_lead_contact(p_lead uuid, p_on boolean default true)
returns timestamptz language plpgsql security definer set search_path = public as $f$
declare me uuid := auth.uid(); v_status text; v_last timestamptz;
begin
  select status into v_status from public.users where id = me;
  if me is null or v_status is distinct from 'active' then raise exception 'Not allowed'; end if;
  if public.my_role() <> 'admin' and not public.can_view_lead(p_lead) then raise exception 'You can only mark your own clients'; end if;

  if p_on then
    insert into public.lead_contacts (lead_id, user_id) values (p_lead, me)
    on conflict (lead_id, user_id) do update set contacted_at = now();
  else
    delete from public.lead_contacts where lead_id = p_lead and user_id = me;
  end if;

  select c.contacted_at into v_last from public.lead_contacts c where c.lead_id = p_lead order by c.contacted_at desc limit 1;
  update public.leads l set
    contacted_at = v_last,
    contacted_by = (select c.user_id from public.lead_contacts c where c.lead_id = p_lead order by c.contacted_at desc limit 1)
  where l.id = p_lead;
  return v_last;
end $f$;
revoke all on function public.set_lead_contact(uuid, boolean) from public, anon;
grant execute on function public.set_lead_contact(uuid, boolean) to authenticated;

/** Clients contacted per person: today (Cairo time), in [p_from, p_to), and all time. */
create or replace function public.contact_stats(p_from timestamptz default null, p_to timestamptz default null)
returns table(user_id uuid, full_name text, role text, today bigint, in_period bigint, total bigint)
language sql stable security definer set search_path = public as $f$
  with b as (
    select coalesce(p_from, date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo') as f,
           coalesce(p_to, now() + interval '1 second') as t,
           date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' as d
  )
  select u.id, u.full_name, u.role,
         count(c.lead_id) filter (where c.contacted_at >= b.d),
         count(c.lead_id) filter (where c.contacted_at >= b.f and c.contacted_at < b.t),
         count(c.lead_id)
  from public.users u
  cross join b
  left join public.lead_contacts c on c.user_id = u.id
  where u.status = 'active'
    and (public.my_role() = 'admin' or u.id = auth.uid() or (public.my_role() = 'manager' and u.manager_id = auth.uid()))
  group by u.id, u.full_name, u.role
  order by 5 desc, u.full_name
$f$;
revoke all on function public.contact_stats(timestamptz, timestamptz) from public, anon;
grant execute on function public.contact_stats(timestamptz, timestamptz) to authenticated;

-- merging duplicate clients (067 / 069) moves lead_id rows to the kept client. If the same person marked both,
-- the move is skipped (the duplicate's mark is then deleted with the duplicate) instead of failing the merge.
create or replace function public._lead_contacts_merge_guard() returns trigger language plpgsql as $f$
begin
  if exists (select 1 from public.lead_contacts c where c.lead_id = new.lead_id and c.user_id = new.user_id) then
    return null;
  end if;
  return new;
end $f$;
drop trigger if exists lead_contacts_merge_guard on public.lead_contacts;
create trigger lead_contacts_merge_guard before update of lead_id on public.lead_contacts
  for each row execute function public._lead_contacts_merge_guard();

notify pgrst, 'reload schema';

-- check
select
  to_regclass('public.lead_contacts') is not null as contacts_table,                                            -- true
  (select count(*) from information_schema.columns where table_name = 'leads' and column_name = 'contacted_at') as leads_column,  -- 1
  to_regproc('public.set_lead_contact') is not null as mark_function,                                          -- true
  to_regproc('public.contact_stats') is not null as stats_function;                                            -- true
