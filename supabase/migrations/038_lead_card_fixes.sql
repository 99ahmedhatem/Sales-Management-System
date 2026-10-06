-- 038 (كان اسمه 037_lead_card_fixes قبل ما 037 يتاخد للصلاحيات): إصلاحات على 034/035 (آمن يتشغّل أكتر من مرة)
--  (1) update_lead_details: كانت بتنادي public.phone_key() وعمود leads.phone_key ومفيش أي منهم في السستم
--      → نستخدم public.phone_last9() من 022 (نفس قاعدة المكرر، وعليها index).
--      وتسجيل تغيير الاسم: trigger التدقيق (016) مش بيشتغل لما الاسم بس يتغير، فنسجّله هنا.
--      ولما الرقم يتعدل يدوياً: phone_source = 'manual' زي شاشة العملاء.
--  (2) get_installments_overview: كانت بتنادي get_deal_installments لكل صفقة قبل فلتر الصلاحية،
--      فالمدير كان بياخد خطأ "You are not allowed to view this deal" لو فيه صفقة مش تبعه.
--      → نفلتر الصفقات المسموحة الأول ونستخدم النسخة الداخلية.

create or replace function public.update_lead_details(p_lead_id uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.leads; k text; v text; olds jsonb := '{}'; news jsonb := '{}';
  allowed text[] := array['name','phone','company','region','website','website_key','source','callback_date','quantity','data_quality','website_status'];
  new_key text;
  new_web text; dup text; website_changed boolean := false;
begin
  if not public.can_edit_lead(p_lead_id) then raise exception 'You are not allowed to edit this client'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'Nothing to update'; end if;
  select * into l from public.leads where id = p_lead_id for update;

  for k in select jsonb_object_keys(p_changes) loop
    if not (k = any(allowed)) then raise exception 'Field "%" cannot be edited here', k; end if;
  end loop;

  if p_changes ? 'name' then
    v := btrim(coalesce(p_changes->>'name',''));
    if v = '' then raise exception 'Name cannot be empty'; end if;
    if v is distinct from l.name then olds := olds || jsonb_build_object('name', l.name); news := news || jsonb_build_object('name', v); end if;
  end if;
  if p_changes ? 'phone' then
    v := nullif(btrim(coalesce(p_changes->>'phone','')), '');
    if v is distinct from l.phone then
      if v is not null and length(regexp_replace(v, '\D', '', 'g')) < 9 then raise exception 'Phone number looks invalid'; end if;
      if v is not null then
        select coalesce(x.client_code, x.customer_number::text, x.name) into dup from public.leads x
        where x.id <> l.id and public.phone_last9(x.phone) = public.phone_last9(v) limit 1;
        if dup is not null then raise exception 'DUPLICATE_PHONE: this phone already belongs to client %', dup; end if;
      end if;
      olds := olds || jsonb_build_object('phone', l.phone); news := news || jsonb_build_object('phone', v);
    end if;
  end if;
  foreach k in array array['company','region','source'] loop
    if p_changes ? k then
      v := nullif(btrim(coalesce(p_changes->>k,'')), '');
      if v is distinct from (to_jsonb(l)->>k) then
        olds := olds || jsonb_build_object(k, to_jsonb(l)->k); news := news || jsonb_build_object(k, v);
      end if;
    end if;
  end loop;
  if p_changes ? 'website' then
    new_web := nullif(btrim(coalesce(p_changes->>'website','')), '');
    if new_web is distinct from l.website then
      new_key := nullif(btrim(coalesce(p_changes->>'website_key','')), '');
      if new_web is not null and new_key is null then raise exception 'website_key is required when changing the website'; end if;
      if new_key is not null then
        select coalesce(x.client_code, x.customer_number::text, x.name) into dup from public.leads x
        where x.id <> l.id and x.website_key = new_key limit 1;
        if dup is not null then raise exception 'DUPLICATE_WEBSITE: this website already belongs to client %', dup; end if;
      end if;
      olds := olds || jsonb_build_object('website', l.website); news := news || jsonb_build_object('website', new_web, 'website_key', new_key);
      website_changed := true;
    end if;
  elsif p_changes ? 'website_key' then
    raise exception 'website_key can only be sent together with website';
  end if;
  if p_changes ? 'callback_date' then
    v := nullif(p_changes->>'callback_date','');
    if v is distinct from l.callback_date::text then
      olds := olds || jsonb_build_object('callback_date', l.callback_date); news := news || jsonb_build_object('callback_date', v);
    end if;
  end if;
  if p_changes ? 'quantity' then
    v := nullif(p_changes->>'quantity','');
    if v is not null and (v !~ '^\d{1,9}$') then raise exception 'Quantity must be a positive number'; end if;
    if v is distinct from l.quantity::text then
      olds := olds || jsonb_build_object('quantity', l.quantity); news := news || jsonb_build_object('quantity', v::int);
    end if;
  end if;
  if p_changes ? 'data_quality' then
    v := p_changes->>'data_quality';
    if v not in ('high','medium','normal') then raise exception 'Invalid data quality'; end if;
    if v is distinct from l.data_quality then olds := olds || jsonb_build_object('data_quality', l.data_quality); news := news || jsonb_build_object('data_quality', v); end if;
  end if;
  if p_changes ? 'website_status' then
    v := nullif(p_changes->>'website_status','');
    if v is not null and v not in ('working','not_working') then raise exception 'Invalid website status'; end if;
    if v is distinct from l.website_status then olds := olds || jsonb_build_object('website_status', l.website_status); news := news || jsonb_build_object('website_status', v); end if;
  end if;

  if news = '{}'::jsonb then return jsonb_build_object('changed', false); end if;

  begin
    update public.leads x set
      name = coalesce(news->>'name', x.name),
      phone = case when news ? 'phone' then news->>'phone' else x.phone end,
      phone_source = case when news ? 'phone' then (case when news->>'phone' is null then null else 'manual' end) else x.phone_source end,
      company = case when news ? 'company' then news->>'company' else x.company end,
      region = case when news ? 'region' then news->>'region' else x.region end,
      source = case when news ? 'source' then news->>'source' else x.source end,
      website = case when news ? 'website' then news->>'website' else x.website end,
      website_key = case when news ? 'website' then news->>'website_key' else x.website_key end,
      callback_date = case when news ? 'callback_date' then (news->>'callback_date')::date else x.callback_date end,
      quantity = case when news ? 'quantity' then (news->>'quantity')::int else x.quantity end,
      data_quality = coalesce(news->>'data_quality', x.data_quality),
      website_status = case when news ? 'website_status' then news->>'website_status'
                            when website_changed then null else x.website_status end,
      website_status_source = case when news ? 'website_status' then (case when news->>'website_status' is null then null else 'manual' end)
                                   when website_changed then null else x.website_status_source end,
      website_checked_at = case when website_changed then null else x.website_checked_at end,
      website_claimed_at = case when website_changed then null else x.website_claimed_at end,
      website_check_category = case when website_changed then null else x.website_check_category end,
      website_check_note = case when website_changed then null else x.website_check_note end,
      updated_at = now()
    where x.id = p_lead_id;

  exception when unique_violation then
    if news ? 'website' then raise exception 'DUPLICATE_WEBSITE: another client already has this website'; end if;
    raise exception 'DUPLICATE_PHONE: another client already has this phone';
  end;

  -- تغيير الرقم بيسجله trigger التدقيق (016) تلقائياً؛ هنا نسجّل باقي الحقول (ومنها الاسم)
  olds := olds - 'phone'; news := news - 'phone';
  if news <> '{}'::jsonb then
    insert into public.audit_log (table_name, row_id, action, changed_by, old_data, new_data)
    values ('leads', p_lead_id::text, 'UPDATE', auth.uid(), olds, news);
  end if;
  return jsonb_build_object('changed', true);
end $$;

create or replace function public.get_installments_overview(p_days_ahead int default 14)
returns table (deal_id uuid, client_name text, client_code text, seq int, due_date date, remaining_sar numeric, status text, days_to_due int, owner_name text)
language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean := public.my_role() = 'admin';
begin
  if public.my_role() not in ('admin','manager') then raise exception 'Only admin or manager'; end if;
  return query
  with ds as (
    select distinct i.deal_id as did from public.deal_installments i
  ), allowed as (
    select ds.did from ds where v_admin or public.can_view_deal(ds.did)
  )
  select a.did, l.name, l.client_code, x.seq, x.due_date, x.remaining_sar, x.status, x.days_to_due, u.full_name
  from allowed a
  join public.deals d on d.id = a.did
  join public.leads l on l.id = d.lead_id
  left join public.users u on u.id = coalesce(d.sales_user_id, d.closed_by_user_id)
  cross join lateral public.get_deal_installments_internal(a.did) x
  where d.status <> 'cancelled' and x.status in ('overdue','partial','pending') and x.remaining_sar > 0
    and x.days_to_due <= p_days_ahead
  order by x.due_date, l.name;
end $$;

revoke all on function public.update_lead_details(uuid, jsonb), public.get_installments_overview(int) from public, anon;
grant execute on function public.update_lead_details(uuid, jsonb), public.get_installments_overview(int) to authenticated;
