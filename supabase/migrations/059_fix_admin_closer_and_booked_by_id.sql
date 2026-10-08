-- 059: fixes for 058 (pasted as "061"). Safe to run more than once.
--
-- 1) snapshot_deal_commissions (058) writes role_in_deal = 'closer_admin' when an admin closed the deal,
--    but 055's check only allows closer_sales / closer_telesales / closer_manager / lead_telesales / manager.
--    The insert runs inside the approve trigger, so approve_deal failed for every deal an admin closed.
-- 2) accept_meeting_request (058) inserts meetings.booked_by_id, a column no migration creates.
--    Without it every "Accept & Schedule" fails with "column booked_by_id does not exist".
--    Adding it (same value as booked_by) works whether or not the live table already has it.

-- ---------- 1) allow closer_admin ----------
do $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.deal_commissions'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role_in_deal%'
  loop
    execute format('alter table public.deal_commissions drop constraint %I', c);
  end loop;
end $$;
alter table public.deal_commissions add constraint deal_commissions_role_in_deal_check
  check (role_in_deal in ('closer_sales','closer_telesales','closer_manager','closer_admin','lead_telesales','manager'));

-- ---------- 2) meetings.booked_by_id ----------
alter table public.meetings add column if not exists booked_by_id uuid references public.users(id);
alter table public.meetings disable trigger user;  -- no audit_log row per meeting for the backfill
update public.meetings set booked_by_id = booked_by where booked_by_id is null;
alter table public.meetings enable trigger user;

notify pgrst, 'reload schema';
