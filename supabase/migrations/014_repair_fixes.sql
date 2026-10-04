-- =====================================================================
-- 014 — إصلاحات على 011 (شغّله بعد 013، آمن لو اتشغّل تاني؛ كان اسمه 012_repair_fixes)
--
-- 1) تأكيد الإيميل: 009_email_confirm_toggle كان بيخزّن علامة في public.users.email_confirmed
--    مالهاش أي تأثير على الدخول، و011 ما بيستبدلش الفانكشنز لو موجودة. هنا بنخلّيهم
--    دايماً يقروا/يكتبوا auth.users.email_confirmed_at (الحالة الحقيقية).
-- 2) fill_missing_phones: لو my_role() رجّعت null، شرط `not in` كان بيعدّي.
-- 3) refresh_deal_commission_cache: لو صف عمولة القافل اتمسح، الكاش كان بيفضل بالقيمة القديمة.
-- =====================================================================

-- 1) تأكيد الإيميل
create or replace function public.list_email_confirmations()
returns table (id uuid, confirmed boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), '') <> 'admin' then
    raise exception 'Only admin can read email confirmations';
  end if;
  return query select u.id, (au.email_confirmed_at is not null)
               from public.users u left join auth.users au on au.id = u.id;
end $$;
revoke execute on function public.list_email_confirmations() from public, anon;
grant execute on function public.list_email_confirmations() to authenticated;

create or replace function public.set_user_email_confirmed(target_user_id uuid, should_confirm boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), '') <> 'admin' then
    raise exception 'Only admin can change email confirmation';
  end if;
  update auth.users
     set email_confirmed_at = case when should_confirm then coalesce(email_confirmed_at, now()) else null end
   where id = target_user_id;
  if not found then raise exception 'User not found'; end if;
end $$;
revoke execute on function public.set_user_email_confirmed(uuid, boolean) from public, anon;
grant execute on function public.set_user_email_confirmed(uuid, boolean) to authenticated;

-- 2) fill_missing_phones (نفس تعريف 011 مع شرط صلاحية مقفول على null)
do $$
begin
  if to_regprocedure('public.fill_missing_phones(jsonb)') is null
     or pg_get_function_result('public.fill_missing_phones(jsonb)'::regprocedure) = 'integer' then
    execute $f$
      create or replace function public.fill_missing_phones(rows jsonb)
      returns integer
      language plpgsql security definer set search_path = public as $b$
      declare n integer;
      begin
        if coalesce(public.my_role(), '') not in ('admin','manager') then
          raise exception 'Only admin or manager can import phones';
        end if;
        with src as (
          select r ->> 'website_key' as website_key,
                 nullif(regexp_replace(coalesce(r ->> 'phone', ''), '[^0-9+]', '', 'g'), '') as phone
          from jsonb_array_elements(rows) r
        ), upd as (
          update public.leads l
             set phone = s.phone, phone_source = 'manual', updated_at = now()
            from src s
           where s.website_key is not null and s.phone is not null
             and l.website_key = s.website_key
             and (l.phone is null or l.phone = '')
          returning 1
        ) select count(*) into n from upd;
        return n;
      end $b$
    $f$;
    revoke execute on function public.fill_missing_phones(jsonb) from public, anon;
    grant execute on function public.fill_missing_phones(jsonb) to authenticated;
  else
    raise notice 'fill_missing_phones has a different return type; left unchanged';
  end if;
end $$;

-- 3) كاش عمولة الديل: يرجع null لو مفيش صف للقافل
do $$
begin
  if to_regclass('public.deal_commissions') is not null then
    create or replace function public.refresh_deal_commission_cache(p_deal_id uuid)
    returns void language plpgsql security definer set search_path = public as $f$
    declare p numeric;
    begin
      select percent into p from public.deal_commissions
       where deal_id = p_deal_id and role_in_deal in ('closer_sales','closer_telesales')
       order by created_at limit 1;
      update public.deals d
         set commission_percent = p,
             commission_sar = case when p is null then null else round(d.price_sar * p / 100, 2) end
       where d.id = p_deal_id;
    end $f$;
    revoke execute on function public.refresh_deal_commission_cache(uuid) from public, anon, authenticated;

    perform public.refresh_deal_commission_cache(d.id) from public.deals d;
  end if;
end $$;

notify pgrst, 'reload schema';
