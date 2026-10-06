-- 034: كارت العميل — عرض كل البيانات + تعديلها + كومنتات + تاريخ التعديلات (بصلاحيات حسب الدور)
-- عرض: أدمن (الكل) · مدير (عملاؤه وعملاء فريقه واجتماعات فريقه) · تيليسيلز (عملاؤه) · سيلز (عملاء اجتماعاته/صفقاته)
-- تعديل: أدمن · مدير (فريقه) · تيليسيلز (عملاؤه). السيلز: عرض + كومنت فقط.

create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); r text := public.my_role(); l public.leads;
begin
  if me is null or r is null then return false; end if;
  select * into l from public.leads where id = p_lead_id;
  if not found then return false; end if;
  if r = 'admin' then return true; end if;
  if r = 'telesales' then return coalesce(l.assigned_to = me, false); end if;
  if r = 'sales' then
    return exists (select 1 from public.meetings m where m.lead_id = l.id and m.assigned_sales_id = me)
        or exists (select 1 from public.deals d where d.lead_id = l.id and d.sales_user_id = me);
  end if;
  if r = 'manager' then
    return coalesce(l.assigned_to = me, false)
        or coalesce(l.assigned_to in (select u.id from public.users u where u.manager_id = me), false)
        or exists (select 1 from public.meetings m where m.lead_id = l.id
                   and m.assigned_sales_id in (select u.id from public.users u where u.manager_id = me));
  end if;
  return false;
end $$;

create or replace function public.can_edit_lead(p_lead_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); r text := public.my_role(); l public.leads;
begin
  if me is null or r is null then return false; end if;
  select * into l from public.leads where id = p_lead_id;
  if not found then return false; end if;
  if r = 'admin' then return true; end if;
  if r = 'telesales' then return coalesce(l.assigned_to = me, false); end if;
  if r = 'manager' then
    return coalesce(l.assigned_to = me, false)
        or coalesce(l.assigned_to in (select u.id from public.users u where u.manager_id = me), false);
  end if;
  return false;
end $$;

-- ---------- كارت كامل ----------
create or replace function public.get_lead_card(p_lead_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads; owner text; res jsonb;
begin
  if not public.can_view_lead(p_lead_id) then raise exception 'You are not allowed to view this client'; end if;
  select * into l from public.leads where id = p_lead_id;
  select u.full_name into owner from public.users u where u.id = l.assigned_to;
  res := jsonb_build_object(
    'lead', jsonb_build_object(
      'id', l.id, 'client_code', l.client_code, 'customer_number', l.customer_number, 'name', l.name, 'phone', l.phone,
      'company', l.company, 'region', l.region, 'website', l.website, 'website_status', l.website_status,
      'website_status_source', l.website_status_source, 'website_check_category', l.website_check_category,
      'website_check_note', l.website_check_note, 'website_checked_at', l.website_checked_at,
      'is_salla_store', l.is_salla_store, 'status', l.status, 'source', l.source, 'data_quality', l.data_quality,
      'callback_date', l.callback_date, 'quantity', l.quantity, 'assigned_to', l.assigned_to, 'owner_name', owner,
      'created_at', l.created_at, 'updated_at', l.updated_at),
    'can_edit', public.can_edit_lead(p_lead_id),
    'comments', coalesce((select jsonb_agg(c order by c.created_at desc) from (
        select cc.id, cc.author_name, cc.text, cc.created_at from public.client_comments cc
        where cc.lead_id = p_lead_id order by cc.created_at desc limit 100) c), '[]'::jsonb),
    'deals', coalesce((select jsonb_agg(d order by d.created_at desc) from (
        select dd.id, dd.status, dd.package_name, dd.price_sar, dd.created_at from public.deals dd
        where dd.lead_id = p_lead_id) d), '[]'::jsonb),
    'meetings', coalesce((select jsonb_agg(m order by m.proposed_date desc) from (
        select mm.id, mm.proposed_date, mm.outcome from public.meetings mm where mm.lead_id = p_lead_id) m), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(h order by h.created_at desc) from (
        select a.created_at, coalesce(u.full_name, '—') as who, a.action, a.old_data, a.new_data
        from public.audit_log a left join public.users u on u.id = a.changed_by
        where a.table_name = 'leads' and a.row_id = p_lead_id::text
        order by a.created_at desc limit 30) h), '[]'::jsonb));
  return res;
end $$;

-- ---------- تعديل ----------
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
      if v is not null and public.phone_key(v) is null then raise exception 'Phone number looks invalid'; end if;
      if v is not null then
        select x.client_code into dup from public.leads x where x.id <> l.id and x.phone_key = public.phone_key(v) limit 1;
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
      -- website_key يحسبه الموقع بنفس دالة الاستيراد ويبعته مع الرابط؛ التكرار تمسكه قاعدة البيانات (unique index)
      new_key := nullif(btrim(coalesce(p_changes->>'website_key','')), '');
      if new_web is not null and new_key is null then raise exception 'website_key is required when changing the website'; end if;
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

  -- name/phone بيسجلهم trigger التدقيق تلقائياً؛ هنا نسجّل باقي الحقول بس (من غير تكرار)
  olds := olds - 'name' - 'phone'; news := news - 'name' - 'phone';
  if news <> '{}'::jsonb then
    insert into public.audit_log (table_name, row_id, action, changed_by, old_data, new_data)
    values ('leads', p_lead_id::text, 'UPDATE', auth.uid(), olds, news);
  end if;
  return jsonb_build_object('changed', true);
end $$;

-- ---------- كومنت ----------
create or replace function public.add_lead_comment(p_lead_id uuid, p_text text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t text := btrim(coalesce(p_text,'')); nm text; owner uuid; cid uuid;
begin
  if not public.can_view_lead(p_lead_id) then raise exception 'You are not allowed to comment on this client'; end if;
  if t = '' then raise exception 'Comment cannot be empty'; end if;
  if length(t) > 2000 then raise exception 'Comment is too long (max 2000 characters)'; end if;
  select full_name into nm from public.users where id = me;
  insert into public.client_comments (lead_id, author_id, author_name, text)
  values (p_lead_id, me, coalesce(nm, '-'), t) returning id into cid;
  select assigned_to into owner from public.leads where id = p_lead_id;
  if owner is not null and owner <> me then
    insert into public.notifications (user_id, type, title, message)
    values (owner, 'comment', 'تعليق جديد على عميل', coalesce(nm,'-') || ': ' || left(t, 120));
  end if;
  return cid;
end $$;

revoke all on function public.can_view_lead(uuid), public.can_edit_lead(uuid), public.get_lead_card(uuid),
  public.update_lead_details(uuid, jsonb), public.add_lead_comment(uuid, text) from public, anon;
grant execute on function public.can_view_lead(uuid), public.can_edit_lead(uuid), public.get_lead_card(uuid),
  public.update_lead_details(uuid, jsonb), public.add_lead_comment(uuid, text) to authenticated;
