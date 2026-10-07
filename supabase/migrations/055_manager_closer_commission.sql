-- 055 (originally pasted as "059"; saved under the next free number).
-- A manager who closes a deal himself gets his closing percent (closer_percent) like a sales user.
--  · deal_commissions.role_in_deal now allows 'closer_manager' (008's check only allowed
--    closer_sales / closer_telesales / lead_telesales / manager — without this the approve trigger
--    would fail and block approve_deal for every deal a manager closed).
--  · snapshot_deal_commissions: closer can be sales / telesales / manager.
--  · refresh_deal_commission_cache: deals.commission_percent/_sar also read 'closer_manager'.
-- Applies to deals approved after this runs; already approved deals keep their snapshot
-- (admin can add one with set_deal_commission(deal, manager, 'closer_manager', percent)).

-- ---------- 1) allow the new role ----------
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
  check (role_in_deal in ('closer_sales','closer_telesales','closer_manager','lead_telesales','manager'));

-- ---------- 2) snapshot ----------
create or replace function public.snapshot_deal_commissions(p_deal_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare d public.deals; v_closer public.users; v_member public.users; v_pct numeric;
begin
  select * into d from public.deals where id = p_deal_id;
  select * into v_closer from public.users where id = d.closed_by_user_id;

  -- 1) اللي قفل الديل (سيلز / تيلي سيلز / مدير)
  if v_closer.role in ('sales','telesales','manager') then
    v_pct := coalesce((select closer_percent from public.user_commission_rates where user_id = v_closer.id), 0);
    insert into public.deal_commissions (deal_id, user_id, role_in_deal, source_user_id, percent)
    values (p_deal_id, v_closer.id,
            case v_closer.role when 'sales' then 'closer_sales' when 'telesales' then 'closer_telesales' else 'closer_manager' end,
            v_closer.id, v_pct)
    on conflict do nothing;
  end if;

  -- 2) اللي أدخل العميل (تيلي سيلز أو مدير) لو غير اللي قفل
  if d.telesales_user_id is not null and d.telesales_user_id <> d.closed_by_user_id then
    v_pct := coalesce((select lead_percent from public.user_commission_rates where user_id = d.telesales_user_id), 0);
    insert into public.deal_commissions (deal_id, user_id, role_in_deal, source_user_id, percent)
    values (p_deal_id, d.telesales_user_id, 'lead_telesales', d.telesales_user_id, v_pct)
    on conflict do nothing;
  end if;

  -- 3) نسبة المدير على كل موظف تحته له علاقة بالديل
  for v_member in
    select u.* from public.users u
    where u.id in (d.closed_by_user_id, d.telesales_user_id)
      and u.manager_id is not null and u.role in ('sales','telesales')
  loop
    v_pct := coalesce((select manager_percent from public.user_commission_rates where user_id = v_member.id), 0);
    if v_pct > 0 then
      insert into public.deal_commissions (deal_id, user_id, role_in_deal, source_user_id, percent)
      values (p_deal_id, v_member.manager_id, 'manager', v_member.id, v_pct)
      on conflict do nothing;
    end if;
  end loop;
end $function$;
revoke execute on function public.snapshot_deal_commissions(uuid) from public, anon, authenticated;

-- ---------- 3) cached closer percent on deals ----------
create or replace function public.refresh_deal_commission_cache(p_deal_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare p numeric;
begin
  select percent into p from public.deal_commissions
   where deal_id = p_deal_id and role_in_deal in ('closer_sales','closer_telesales','closer_manager')
   order by created_at limit 1;
  update public.deals d set commission_percent = p,
         commission_sar = case when p is null then null else round(d.price_sar * p / 100, 2) end
   where d.id = p_deal_id;
end $function$;
revoke execute on function public.refresh_deal_commission_cache(uuid) from public, anon, authenticated;
